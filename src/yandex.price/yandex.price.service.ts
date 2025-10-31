import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { chunk, toNumber } from 'lodash';
import { YandexOfferService } from '../yandex.offer/yandex.offer.service';
import { GoodsStatsDto } from '../yandex.offer/dto/goods.stats.dto';
import { YandexProductCoeffsAdapter } from './yandex.product.coeffs.adapter';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { UpdateOfferDto } from './dto/update.offer.dto';
import { VaultService } from 'vault-module/lib/vault.service';
import { UpdateBusinessOfferPriceDto } from './dto/update.business.offer.price.dto';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import Excel from 'exceljs';
import { GoodServiceEnum } from '../good/good.service.enum';
import { IVatUpdateable } from '../interfaces/i.vat.updateable';
import { RateLimit } from '../helpers/decorators/rate-limit.decorator';
@Injectable()
export class YandexPriceService implements IPriceUpdateable, IVatUpdateable, OnModuleInit {
    private logger = new Logger(YandexPriceService.name);
    private businessId: string;
    constructor(
        private configService: ConfigService,
        private offerService: YandexOfferService,
        private api: YandexApiService,
        private vaultService: VaultService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
    ) {}
    async onModuleInit(): Promise<void> {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (!services.includes(GoodServiceEnum.YANDEX)) {
            return;
        }
        const yandex = await this.vaultService.get('yandex-seller');
        this.businessId = yandex['electronica-business'] as string;
    }
    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: this.configService.get<number>('YANDEX_MIN_MIL', 40),
            percMil: toNumber(this.configService.get<number>('YANDEX_PERC_MIL', 5.5)),
            percEkv: this.configService.get<number>('YANDEX_PERC_EKV', 1),
            sumObtain: toNumber(this.configService.get<number>('YANDEX_SUM_PACK', 25)),
            sumLabel: toNumber(this.configService.get<number>('SUM_LABEL', 13)),
            taxUnit: toNumber(this.configService.get<number>('TAX_UNIT', 6)),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        const data: GoodsStatsDto = await this.offerService.getSkus(skus);

        if (!data || !data.shopSkus) {
            return [];
        }

        return data.shopSkus.map((shopSku) => new YandexProductCoeffsAdapter(shopSku));
    }

    async updatePrices(updatePrices: UpdatePriceDto[]): Promise<any> {
        return {
            offerUpdate: await this.updateOfferPrices(updatePrices),
            incomingUpdate: await this.updateIncomingPrices(updatePrices),
        };
    }

    async updateIncomingPrices(prices: UpdatePriceDto[]): Promise<any> {
        const packing =
            this.configService.get<number>('SUM_LABEL', 10) + this.configService.get<number>('YANDEX_SUM_PACK', 15);
        const updates = prices.map(
            (price): UpdateOfferDto => ({
                offerId: price.offer_id,
                cofinancePrice: { value: parseInt(price.min_price), currencyId: 'RUR' },
                purchasePrice: { value: parseInt(price.min_price), currencyId: 'RUR' },
                // { value: Math.ceil(price.incoming_price), currencyId: 'RUR' },
                additionalExpenses: { value: packing + (price.sum_pack || 0), currencyId: 'RUR' },
            }),
        );
        const offerMappings = updates.map((offer) => ({ offer }));
        return this.api.method(`businesses/${this.businessId}/offer-mappings/update`, 'post', {
            offerMappings,
        });
    }

    async updateOfferPrices(prices: UpdatePriceDto[]): Promise<any> {
        const offers = prices.map(
            (price): UpdateBusinessOfferPriceDto => ({
                offerId: price.offer_id,
                price: {
                    currencyId: 'RUR',
                    discountBase: parseFloat(price.old_price),
                    value: parseFloat(price.price),
                },
            }),
        );
        return this.api.method(`businesses/${this.businessId}/offer-prices/updates`, 'post', { offers });
    }
    // @Cron('0 5 0 * * 0', { name: 'updateYandexPrices' })
    async updateAllPrices(level = 0, args = ''): Promise<void> {
        const offers = await this.offerService.getShopSkus(args);
        await this.goodService.updatePriceForService(this, Array.from(offers.goods.keys()));
        if (offers.nextArgs) {
            await this.updateAllPrices(level + 1, offers.nextArgs);
        }
        if (level === 0) {
            this.logger.log('All Yandex Prices was updated');
        }
    }

    /**
     * Получить маппинги офферов с ценами и НДС
     * @param offerIds - массив ID офферов (до 200 штук)
     * @returns массив маппингов офферов
     */
    async getOfferMappings(offerIds: string[]): Promise<any[]> {
        const response = await this.api.method(
            `businesses/${this.businessId}/offer-mappings`,
            'post',
            { offerIds }
        );
        return response.result?.offerMappings ?? [];
    }

    async getDisountPrices(skus: string[]): Promise<Map<string, number[]>> {
        const response = [];
        for (const offerIds of chunk(skus, 200)) {
            const mappings = await this.getOfferMappings(offerIds);
            response.push(...mappings);
        }
        const res = new Map<string, number[]>();
        response
            .filter((value) => !!value.offer.purchasePrice)
            .forEach((value) => {
                res.set(value.offer.offerId, [value.offer.purchasePrice.value, value.offer.basicPrice.discountBase]);
            });
        return res;
    }

    async createAction(file: Express.Multer.File): Promise<Excel.Buffer> {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(file.buffer as any);
        const worksheet = workbook.getWorksheet('Товары и цены');
        const skus: string[] = [];
        let i = 11;
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (rowNumber > 8) {
                skus.push(row.getCell(3).value.toString());
            } else if (rowNumber === 7) {
                for (i = 9; i <= row.cellCount; i++) {
                    if (row.getCell(i).value === 'Максимальная цена для участия в акции') break;
                }
            }
        });
        const discountPrices = await this.getDisountPrices(skus);
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (
                rowNumber > 8 &&
                discountPrices.get(row.getCell(3).value.toString()) &&
                parseInt(row.getCell(i).value.toString()) >= discountPrices.get(row.getCell(3).value.toString())[0]
            ) {
                row.getCell(row.cellCount + 1).value = discountPrices.get(row.getCell(3).value.toString())[1];
                row.getCell(row.cellCount + 1).value = discountPrices.get(row.getCell(3).value.toString())[0];
            }
        });
        return workbook.xlsx.writeBuffer();
    }

    // IVatUpdateable interface methods
    async checkVatForAll(expectedVat: number, limit?: number): Promise<Array<{ offer_id: string; current_vat: number; expected_vat: number; }>> {
        this.logger.log(`Проверка НДС для Yandex. Ожидаемая ставка: ${expectedVat}%`);

        // 1. Получить все офферы через старый API campaigns (он возвращает НДС в campaignPrice.vat)
        const allOffers = [];
        let pageToken = '';

        do {
            const result = await this.offerService.index(pageToken, limit || 200);
            if (!result || !result.offers) {
                this.logger.warn('Получен пустой результат от index()');
                break;
            }
            allOffers.push(...result.offers);
            pageToken = result.paging?.nextPageToken || '';
        } while (pageToken);

        this.logger.log(`Получено офферов: ${allOffers.length}`);

        // 2. Конвертируем ожидаемый НДС в Yandex VAT ID
        const expectedVatId = parseInt(this.numberToVat(expectedVat), 10);

        // 3. Фильтруем несоответствия
        // Учитываем только офферы где НДС установлен (есть campaignPrice.vat)
        const mismatches = allOffers
            .filter(offer => {
                const currentVatId = offer.campaignPrice?.vat;
                return currentVatId !== undefined && currentVatId !== expectedVatId;
            })
            .map(offer => ({
                offer_id: offer.offerId,
                current_vat: this.vatToNumber(offer.campaignPrice.vat),
                expected_vat: expectedVat,
            }));

        this.logger.log(`Найдено несоответствий НДС: ${mismatches.length}`);

        return mismatches;
    }

    /**
     * Обновить НДС для списка товаров
     * @param offerIds - массив offer_id товаров
     * @param vat - ставка НДС в процентах (0, 5, 7, 10, 20)
     * @returns результат обновления
     *
     * Ограничения API:
     * - Максимум 500 товаров в одном запросе
     * - Максимум 10 000 товаров в минуту
     * - Rate limit: 3 секунды между запросами (500 товаров каждые 3 сек = 10000/мин)
     */
    @RateLimit(3000)
    async updateVat(offerIds: string[], vat: number): Promise<any> {
        this.logger.log(`Обновление НДС для ${offerIds.length} офферов. Новая ставка: ${vat}%`);

        const vatId = parseInt(this.numberToVat(vat), 10);
        const campaignId = (this.offerService as any).campaignId;

        // Разбиваем на чанки по 500 товаров (максимум для API)
        const results = [];
        for (const offerIdsChunk of chunk(offerIds, 500)) {
            const offers = offerIdsChunk.map((offerId: string) => ({
                offerId,
                vat: vatId
            }));

            this.logger.log(`Обновление чанка из ${offers.length} товаров`);

            const response = await this.api.method(
                `v2/campaigns/${campaignId}/offers/update`,
                'post',
                { offers }
            );

            results.push(response);
        }

        this.logger.log(`НДС обновлен для ${offerIds.length} товаров. Статус: ${results[0]?.status}`);

        return results.length === 1 ? results[0] : { results, totalUpdated: offerIds.length };
    }

    /**
     * Преобразует Yandex VAT ID в проценты
     * 2 → 10%, 5 → 0%, 6 → -1 (не облагается), 7 → 20%, 10 → 5%, 11 → 7%
     */
    vatToNumber(vat: any): number {
        const vatId = parseInt(String(vat), 10);
        const mapping: Record<number, number> = {
            2: 10,   // НДС 10%
            5: 0,    // НДС 0%
            6: -1,   // Не облагается
            7: 20,   // НДС 20%
            10: 5,   // НДС 5% (УСН)
            11: 7,   // НДС 7% (УСН)
        };
        return mapping[vatId] ?? 0;
    }

    /**
     * Преобразует проценты в Yandex VAT ID
     * 10% → 2, 0% → 5, -1 → 6, 20% → 7, 5% → 10, 7% → 11
     */
    numberToVat(vat: number): string {
        const mapping: Record<number, number> = {
            10: 2,   // НДС 10%
            0: 5,    // НДС 0%
            [-1]: 6, // Не облагается
            20: 7,   // НДС 20%
            5: 10,   // НДС 5% (УСН)
            7: 11,   // НДС 7% (УСН)
        };
        return String(mapping[vat] ?? 7); // По умолчанию 7 (20%)
    }
}
