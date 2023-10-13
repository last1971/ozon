import { Inject, Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import {
    calculatePrice,
    goodCode,
    goodQuantityCoeff,
    productQuantity,
    skusToGoodIds,
    StringToIOfferIdableAdapter,
} from '../helpers';
import { ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { chunk, flatten, snakeCase, toUpper } from 'lodash';

@Injectable()
export class Trade2006GoodService implements IGood {
    constructor(
        @Inject(FIREBIRD) private db: FirebirdDatabase,
        private configService: ConfigService,
    ) {}

    async in(codes: string[]): Promise<GoodDto[]> {
        if (codes.length === 0) return [];
        const response: any[] = await this.db.query(
            `SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN, (SELECT SUM(QUANSHOP) + SUM(QUANSKLAD) from RESERVEDPOS where GOODS.GOODSCODE = RESERVEDPOS.GOODSCODE) AS RES  FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE WHERE GOODS.GOODSCODE IN (${'?'
                .repeat(codes.length)
                .split('')
                .join()})`,
            codes,
        );
        return response.map((item): GoodDto => ({ code: item.GOODSCODE, quantity: item.QUAN, reserve: item.RES }));
    }

    async prices(codes: string[]): Promise<GoodPriceDto[]> {
        if (codes.length === 0) return [];
        const response: any[] = await this.db.query(
            'select g.goodscode, n.name, ' +
                '( select sum(t.ost * t.price)/sum(t.ost) from (select price, quan -  COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) as ost' +
                '  from pr_meta where pr_meta.goodscode=g.goodscode and pr_meta.shopincode is not null' +
                '  and COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) < quan) t' +
                ') as pric from goods g, name n ' +
                `where g.namecode=n.namecode and g.goodscode in (${'?'.repeat(codes.length).split('').join()})`,
            codes,
        );
        return response.map(
            (good: any): GoodPriceDto => ({
                code: good.GOODSCODE,
                name: good.NAME,
                price: good.PRIC,
            }),
        );
    }
    async getPerc(codes: string[]): Promise<GoodPercentDto[]> {
        if (codes.length === 0) return [];
        const pecents = await this.db.query(
            `select * from ozon_perc where goodscode in (${'?'.repeat(codes.length).split('').join()})`,
            codes,
        );
        return pecents.map((percent) => ({
            offer_id: percent.GOODSCODE,
            pieces: percent.PIECES,
            perc: percent.PERC_NOR,
            adv_perc: percent.PERC_ADV,
            old_perc: percent.PERC_MAX,
            min_perc: percent.PERC_MIN,
            packing_price: percent.PACKING_PRICE ?? this.configService.get<number>('SUM_PACK', 10),
        }));
    }
    async setPercents(perc: GoodPercentDto): Promise<void> {
        await this.db.execute(
            'UPDATE OR INSERT INTO OZON_PERC (PERC_MIN, PERC_NOR, PERC_MAX, PERC_ADV, PACKING_PRICE, GOODSCODE,' +
                ' PIECES)' +
                'VALUES (?, ?, ?, ?, ?, ?, ?) MATCHING (GOODSCODE, PIECES)',
            [
                perc.min_perc || null,
                perc.perc || null,
                perc.old_perc || null,
                perc.adv_perc || null,
                perc.packing_price || null,
                goodCode(perc),
                goodQuantityCoeff(perc),
            ],
        );
    }

    async setWbData(data: GoodWbDto): Promise<void> {
        const attribs = [];
        const values = [];
        let count = 0;
        for (const key in data) {
            if (data[key]) {
                count++;
                attribs.push(toUpper(snakeCase(key)));
                values.push(data[key]);
            }
        }
        await this.db.execute(
            `UPDATE OR INSERT INTO WILDBERRIES (${attribs.join()}) VALUES (${'?'
                .repeat(count)
                .split('')
                .join()}) MATCHING (ID)`,
            values,
        );
    }

    async getWbData(ids: string[]): Promise<GoodWbDto[]> {
        const wbData: any[] = flatten(
            await Promise.all(
                chunk(ids, 50).map((part: string[]) =>
                    this.db.query(
                        `SELECT *
                 FROM WILDBERRIES
                 WHERE ID IN (${'?'.repeat(part.length).split('').join()})`,
                        part,
                    ),
                ),
            ),
        );
        return wbData.map(
            (data): GoodWbDto => ({
                id: data.ID,
                commission: data.COMMISSION,
                tariff: data.TARIFF,
                minPrice: data.MIN_PRICE,
            }),
        );
    }

    async getQuantities(goodCodes: string[]): Promise<Map<string, number>> {
        return new Map((await this.in(goodCodes)).map((good) => [good.code.toString(), good.quantity - good.reserve]));
    }

    async updateCountForService(service: ICountUpdateable, args: any): Promise<number> {
        const serviceGoods = await service.getGoodIds(args);
        if (serviceGoods.goods.size === 0) return 0;
        const goodIds: string[] = skusToGoodIds(Array.from(serviceGoods.goods.keys()));
        // for (const goodId of serviceGoods.goods.keys()) {
        //    const id = goodCode(new StringToIOfferIdableAdapter(goodId));
        //    if (!goodIds.includes(id)) goodIds.push(id);
        // }
        const goods = await this.getQuantities(goodIds);
        const updateGoods: Map<string, number> = new Map();
        for (const [id, count] of serviceGoods.goods) {
            const item = new StringToIOfferIdableAdapter(id);
            const goodCount = productQuantity(goods.get(goodCode(item)), goodQuantityCoeff(item));
            if (count !== goodCount) {
                updateGoods.set(id, goodCount);
            }
        }
        let count = updateGoods.size === 0 ? 0 : await service.updateGoodCounts(updateGoods);
        if (serviceGoods.nextArgs) {
            count += await this.updateCountForService(service, serviceGoods.nextArgs);
        }
        return count;
    }

    async updateCountForSkus(service: ICountUpdateable, skus: string[]): Promise<number> {
        const goodIds: string[] = skusToGoodIds(skus);
        const goods = await this.getQuantities(goodIds);
        const fullSkus = skus;
        for (const percent of await this.getPerc(goodIds)) {
            const sku = percent.offer_id + '-' + percent.pieces;
            if (percent.pieces > 1 && !fullSkus.includes(sku)) {
                fullSkus.push(sku);
            }
        }
        const updateGoods: Map<string, number> = new Map();
        fullSkus.forEach((sku) => {
            const item = new StringToIOfferIdableAdapter(sku);
            const goodCount = productQuantity(goods.get(goodCode(item)), goodQuantityCoeff(item));
            updateGoods.set(sku, goodCount);
        });
        return service.updateGoodCounts(updateGoods);
    }

    async updatePriceForService(service: IPriceUpdateable, skus: string[]): Promise<any> {
        const codes = skus.map((item) => goodCode({ offer_id: item }));
        const goods = await this.prices(codes);
        const percents = await this.getPerc(codes);
        const products: IProductCoeffsable[] = await service.getProductsWithCoeffs(skus);
        const updatePrices: UpdatePriceDto[] = [];
        products.forEach((product) => {
            const gCode = goodCode({ offer_id: product.getSku() });
            const gCoeff = goodQuantityCoeff({ offer_id: product.getSku() });
            const incoming_price = goods.find((g) => g.code.toString() === gCode).price * gCoeff;
            if (incoming_price !== 0) {
                const { min_perc, perc, old_perc, adv_perc, packing_price } = percents.find(
                    (p) => p.offer_id.toString() === gCode && p.pieces === gCoeff,
                ) || {
                    adv_perc: 0,
                    old_perc: this.configService.get<number>('PERC_MAX', 50),
                    perc: this.configService.get<number>('PERC_NOR', 25),
                    min_perc: this.configService.get<number>('PERC_MIN', 15),
                    packing_price: this.configService.get<number>('SUM_PACK', 10),
                };
                updatePrices.push(
                    calculatePrice(
                        {
                            adv_perc,
                            fbs_direct_flow_trans_max_amount: product.getTransMaxAmount(),
                            incoming_price,
                            min_perc,
                            offer_id: product.getSku(),
                            old_perc,
                            perc,
                            sales_percent: product.getSalesPercent(),
                            sum_pack: packing_price,
                        },
                        service.getObtainCoeffs(),
                    ),
                );
            }
        });
        return service.updatePrices(updatePrices);
    }
}
