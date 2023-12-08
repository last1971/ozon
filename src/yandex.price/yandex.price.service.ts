import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/obtain.coeffs.dto';
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
import { Cron } from '@nestjs/schedule';
import Excel from 'exceljs';
@Injectable()
export class YandexPriceService implements IPriceUpdateable, OnModuleInit {
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
        const yandex = await this.vaultService.get('yandex-seller');
        this.businessId = yandex['electronica-business'] as string;
    }
    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: this.configService.get<number>('YANDEX_MIN_MIL', 40),
            percMil: toNumber(this.configService.get<number>('PERC_MIL', 5.5)),
            percEkv: this.configService.get<number>('YANDEX_PERC_EKV', 1),
            sumObtain: toNumber(this.configService.get<number>('SUM_OBTAIN', 25)),
            sumLabel: toNumber(this.configService.get<number>('SUM_LABEL', 13)),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        const data: GoodsStatsDto = await this.offerService.getSkus(skus);
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
                purchasePrice: { value: Math.ceil(price.incoming_price), currencyId: 'RUR' },
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
    @Cron('0 5 0 * * 0', { name: 'updateYandexPrices' })
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

    async getDisountPrices(skus: string[]): Promise<Map<string, number[]>> {
        const response = await Promise.all(
            chunk(skus, 200).map((offerIds) =>
                this.api.method(`businesses/${this.businessId}/offer-mappings`, 'post', { offerIds }),
            ),
        );
        const res = new Map<string, number[]>();
        response
            .map((value) => value.result.offerMappings)
            .flat()
            .filter((value) => !!value.offer.cofinancePrice)
            .forEach((value) => {
                res.set(value.offer.offerId, [value.offer.cofinancePrice.value, value.offer.basicPrice.discountBase]);
            });
        return res;
    }

    async createAction(file: Express.Multer.File): Promise<Excel.Buffer> {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(file.buffer);
        const worksheet = workbook.getWorksheet(10);
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
}
