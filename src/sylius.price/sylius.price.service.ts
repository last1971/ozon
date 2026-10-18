import { Inject, Injectable, Logger } from '@nestjs/common';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { SyliusApiService } from '../sylius/sylius.api.service';
import { SyliusProductService } from '../sylius/sylius.product.service';
import { SyliusPriceCoeffsAdapter } from './sylius.price.coeffs.adapter';
import {
    buildTiers,
    calculatePrice,
    DEFAULT_TIER_THRESHOLDS,
    DroppedTierDto,
    parseTierDefaults,
    PartyPriceDto,
    pickThresholds,
    QuantityTierDto,
    TierDefaultRow,
} from '../helpers';
import { toNumber } from 'lodash';
import Excel from 'exceljs';

type SyliusPriceEntry = {
    price: number;
    originalPrice?: number;
    minimumPrice?: number;
    tiers?: QuantityTierDto[];
};

@Injectable()
export class SyliusPriceService implements IPriceUpdateable {
    private readonly logger = new Logger(SyliusPriceService.name);
    /** Пороги ступеней по умолчанию от розничной цены (SYLIUS_TIER_DEFAULTS, иначе зашитые). */
    private readonly tierDefaults: TierDefaultRow[];

    constructor(
        private configService: ConfigService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private api: SyliusApiService,
        private syliusProductService: SyliusProductService,
    ) {
        this.tierDefaults = parseTierDefaults(
            this.configService?.get<string>('SYLIUS_TIER_DEFAULTS', DEFAULT_TIER_THRESHOLDS) ?? DEFAULT_TIER_THRESHOLDS,
        );
    }

    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: this.configService.get<number>('SYLIUS_MIN_MIL', 0),
            percMil: this.configService.get<number>('SYLIUS_PERC_MIL', 0),
            percEkv: this.configService.get<number>('SYLIUS_PERC_EKV', 0),
            sumObtain: this.configService.get<number>('SYLIUS_SUM_OBTAIN', 0),
            // Этикетка и упаковка для Sylius свои (SYLIUS_SUM_LABEL / SYLIUS_SUM_PACK), не заданы — общие, как у всех
            sumLabel: this.configService.get<number>(
                'SYLIUS_SUM_LABEL',
                this.configService.get<number>('SUM_LABEL', 2),
            ),
            taxUnit: this.configService.get<number>('TAX_UNIT', 6),
            ...(this.configService.get<number>('SYLIUS_SUM_PACK') !== undefined
                ? { sumPack: toNumber(this.configService.get<number>('SYLIUS_SUM_PACK')) }
                : {}),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        const extPerc = this.configService.get<number>('SYLIUS_EXT_PERC', 0);
        return skus.map((sku) => new SyliusPriceCoeffsAdapter(sku, extPerc));
    }

    async updatePrices(updatePrices: UpdatePriceDto[]): Promise<any> {
        this.logger.log(`Updating ${updatePrices.length} prices on Sylius`);

        if (updatePrices.length === 0) {
            return [];
        }

        const prices: Record<string, SyliusPriceEntry> = {};
        const accepted: UpdatePriceDto[] = [];
        const broken: string[] = [];

        for (const updatePrice of updatePrices) {
            const code = updatePrice.offer_id.toString();

            if (!this.syliusProductService.skuList.includes(code)) {
                continue;
            }

            const entry: SyliusPriceEntry = {
                price: Math.round(parseFloat(updatePrice.price || '0') * 100),
                originalPrice: Math.round(parseFloat(updatePrice.old_price || '0') * 100),
                minimumPrice: Math.round(parseFloat(updatePrice.min_price || '0') * 100),
            };
            // Цена не число (код без себестоимости на складе площадки): в JSON ушёл бы null, Sylius цену пропустил бы,
            // а зачёркнутую и ступени стёр — такой код не отправляем вовсе
            if (![entry.price, entry.originalPrice, entry.minimumPrice].every((v) => Number.isFinite(v) && v > 0)) {
                broken.push(code);
                continue;
            }
            prices[code] = entry;
            accepted.push(updatePrice);
        }
        if (broken.length > 0) {
            this.logger.warn(`Sylius: цена не число, не отправлены (${broken.length}): ${broken.join(', ')}`);
        }

        if (Object.keys(prices).length === 0) {
            this.logger.log('No valid SKUs to update on Sylius');
            return [];
        }

        // Ступени — каждому коду, которому уходит цена: без них `[]`, чтобы в Sylius не жили протухшие ступени
        const tiersByCode = await this.calculateTiers(accepted);
        for (const code of Object.keys(prices)) {
            prices[code].tiers = tiersByCode.get(code) ?? [];
        }

        try {
            const result = await this.api.method<{ updated: number; notFound: number; rejectedTiers?: string[] }>(
                '/api/v2/admin/price/update',
                'post',
                { prices },
            );
            const rejected = result.rejectedTiers ?? [];
            this.logger.log(
                `Sylius: updated ${result.updated}, not found ${result.notFound}, rejected tiers ${rejected.length}`,
            );
            if (rejected.length > 0) {
                this.logger.error(`Sylius отверг ступени цены: ${rejected.join(', ')}`);
            }
            return rejected.map((code) => ({
                offer_id: code,
                error: `Sylius отверг ступени: ${JSON.stringify(prices[code]?.tiers ?? [])}`,
            }));
        } catch (error) {
            this.logger.error('Error updating prices on Sylius:', error.message);
            return [{ offer_id: 'batch', error: error.message }];
        }
    }

    /**
     * Ступени цены от количества по уже посчитанным обычным ценам (решения владельца 17–18.10.2026).
     * Пороги — из Trade или по умолчанию от розничной цены; партия «код-N» считается той же формулой, что и 1 шт,
     * от той же базы: рыночная цена, если задана, иначе закупка, × N; упаковка и этикетка один раз.
     * Наценки партии — строка OZON_PERC (код, PIECES=N), если есть, иначе подбор без повторного чтения базы.
     */
    private async calculateTiers(accepted: UpdatePriceDto[]): Promise<Map<string, QuantityTierDto[]>> {
        const result = new Map<string, QuantityTierDto[]>();
        const codes = accepted.map((p) => p.offer_id.toString());
        const thresholds = await this.goodService.getQuantityThresholds(codes);

        const plan = new Map<string, number[]>();
        const partyCosts = new Map<string, UpdatePriceDto>();
        for (const p of accepted) {
            const code = p.offer_id.toString();
            const retailRub = parseFloat(p.price);
            const unitCost = toNumber(p.available_price) > 0 ? toNumber(p.available_price) : toNumber(p.incoming_price);
            if (!Number.isFinite(retailRub) || !(unitCost > 0)) continue;

            const quantities = pickThresholds(thresholds.get(code), retailRub, this.tierDefaults);
            plan.set(code, quantities);
            for (const quantity of quantities) {
                const sku = `${code}-${quantity}`;
                partyCosts.set(sku, { offer_id: sku, incoming_price: unitCost * quantity } as UpdatePriceDto);
            }
        }
        if (partyCosts.size === 0) return result;

        const priceables = await this.goodService.buildPriceables(this, Array.from(partyCosts.keys()), partyCosts);
        const coeffs = this.getObtainCoeffs();
        const parties = new Map(priceables.map((p) => [p.offer_id, calculatePrice(p, coeffs)]));

        const dropped: { code: string; tier: DroppedTierDto }[] = [];
        for (const [code, quantities] of plan) {
            const partyPrices: PartyPriceDto[] = [];
            for (const quantity of quantities) {
                const party = parties.get(`${code}-${quantity}`);
                if (!party) continue;
                partyPrices.push({ quantity, price: toNumber(party.price), min_price: toNumber(party.min_price) });
            }
            const regularKopecks = Math.round(
                parseFloat(accepted.find((p) => p.offer_id.toString() === code).price) * 100,
            );
            const built = buildTiers(regularKopecks, partyPrices);
            result.set(code, built.tiers);
            built.dropped.forEach((tier) => dropped.push({ code, tier }));
        }

        if (dropped.length > 0) {
            this.logger.warn(
                `Ступени не отправлены (${dropped.length}): ` +
                    dropped.map((d) => `${d.code}×${d.tier.quantity} ${d.tier.reason}`).join('; '),
            );
        }
        return result;
    }

    async updateAllPrices(level = 0, args: any = null): Promise<any> {
        const variants = await this.syliusProductService.getGoodIds(args);
        const errors: any[] =
            (await this.goodService.updatePriceForService(this, Array.from(variants.goods.keys()))) ?? [];

        if (variants.nextArgs) {
            errors.push(...((await this.updateAllPrices(level + 1, variants.nextArgs)) ?? []));
        }

        if (level === 0) {
            this.logger.log(`All Sylius Prices was updated, errors: ${errors.length}`);
        }

        return errors;
    }

    async createAction(_file: Express.Multer.File): Promise<Excel.Buffer> {
        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet('Sylius Prices');
        worksheet.addRow(['SKU', 'Price', 'Status']);
        return workbook.xlsx.writeBuffer() as Promise<Excel.Buffer>;
    }
}
