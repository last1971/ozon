import { Inject, Injectable } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
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
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { chunk, find, flatten, remove, snakeCase, toUpper } from 'lodash';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { Cache } from '@nestjs/cache-manager';
import { WbCommissionDto } from '../wb.card/dto/wb.commission.dto';
import { WithTransactions } from "../helpers/transaction.mixin";
import { PriceCalculationHelper } from "../helpers/price/price.calculation.helper";

@Injectable()
export class Trade2006GoodService extends WithTransactions(class {}) implements IGood {
    private halfStoreMessages: string[] = [];
    private boundCheckMessages: string[] = [];
    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
        private cacheManager: Cache,
        private priceCalculationHelper: PriceCalculationHelper,
    ) {
        super();
    }

    async in(codes: string[], t: FirebirdTransaction = null): Promise<GoodDto[]> {
        if (codes.length === 0) return [];
        const transaction = t ?? (await this.pool.getTransaction());
        const response: any[] = await transaction.query(
            `SELECT GOODS.GOODSCODE, SHOPSKLAD.QUAN, (SELECT SUM(QUANSHOP) + SUM(QUANSKLAD) from RESERVEDPOS where GOODS.GOODSCODE = RESERVEDPOS.GOODSCODE) AS RES, NAME.NAME AS NAME  FROM GOODS JOIN SHOPSKLAD ON GOODS.GOODSCODE = SHOPSKLAD.GOODSCODE JOIN NAME ON GOODS.NAMECODE = NAME.NAMECODE WHERE GOODS.GOODSCODE IN (${'?'
                .repeat(codes.length)
                .split('')
                .join()})`,
            codes,
            !t,
        );
        return response.map(
            (item): GoodDto => ({ code: item.GOODSCODE, quantity: item.QUAN, reserve: item.RES, name: item.NAME }),
        );
    }

    async prices(codes: string[], t: FirebirdTransaction = null): Promise<GoodPriceDto[]> {
        if (codes.length === 0) return [];
        const transaction = t ?? (await this.pool.getTransaction());
        const response: any[] = await transaction.query(
            'select g.goodscode, n.name, ' +
                '( select sum(t.ost * t.price)/sum(t.ost) from (select price, quan -  COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) as ost' +
                '  from pr_meta where pr_meta.goodscode=g.goodscode and pr_meta.shopincode is not null' +
                '  and COALESCE((select sum(quan) from fifo_t where fifo_t.pr_meta_in_id=pr_meta.id), 0) < quan) t' +
                ') as pric from goods g, name n ' +
                `where g.namecode=n.namecode and g.goodscode in (${'?'.repeat(codes.length).split('').join()})`,
            codes,
            !t,
        );
        return response.map(
            (good: any): GoodPriceDto => ({
                code: good.GOODSCODE,
                name: good.NAME,
                price: good.PRIC,
            }),
        );
    }
    async getPerc(codes: string[], t: FirebirdTransaction = null): Promise<GoodPercentDto[]> {
        if (codes.length === 0) return [];
        const transaction = t ?? (await this.pool.getTransaction());
        const pecents = await transaction.query(
            `select * from ozon_perc where goodscode in (${'?'.repeat(codes.length).split('').join()})`,
            codes,
            !t,
        );
        return pecents.map((percent) => ({
            offer_id: percent.GOODSCODE,
            pieces: percent.PIECES,
            perc: percent.PERC_NOR,
            adv_perc: percent.PERC_ADV,
            old_perc: percent.PERC_MAX,
            min_perc: percent.PERC_MIN,
            packing_price: percent.PACKING_PRICE ?? this.configService.get<number>('SUM_PACK', 10),
            available_price: percent.AVAILABLE_PRICE,
        }));
    }
    async setPercents(perc: GoodPercentDto, t: FirebirdTransaction = null): Promise<void> {
        const transaction = t ?? (await this.pool.getTransaction());
        await transaction.execute(
            'UPDATE OR INSERT INTO OZON_PERC (PERC_MIN, PERC_NOR, PERC_MAX, PERC_ADV, PACKING_PRICE,' +
                ' AVAILABLE_PRICE, GOODSCODE, PIECES)' +
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?) MATCHING (GOODSCODE, PIECES)',
            [
                perc.min_perc || null,
                perc.perc || null,
                perc.old_perc || null,
                perc.adv_perc || null,
                perc.packing_price || null,
                perc.available_price ?? 0,
                goodCode(perc),
                goodQuantityCoeff(perc),
            ],
            !t,
        );
    }

    async setWbData(data: GoodWbDto, t: FirebirdTransaction = null): Promise<void> {
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
        const transaction = t ?? (await this.pool.getTransaction());
        await transaction.execute(
            `UPDATE OR INSERT INTO WILDBERRIES (${attribs.join()}) VALUES (${'?'
                .repeat(count)
                .split('')
                .join()}) MATCHING (ID)`,
            values,
            !t,
        );
    }

    /**
     * Fetches data from the Wildberries database for the given IDs.
     * The data is retrieved in chunks to optimize the query performance
     * and then flattened into a single array of results.
     *
     * @param {string[]} ids - An array of IDs corresponding to the Wildberries data to be retrieved.
     * @return {Promise<GoodWbDto[]>} A promise that resolves to an array of GoodWbDto objects containing the retrieved data.
     */
    async getWbData(ids: string[]): Promise<GoodWbDto[]> {
        const wbData: any[] = flatten(
            await Promise.all(
                chunk(ids, 50).map(async (part: string[]) => {
                    const t = await this.pool.getTransaction();
                    return t.query(
                        `SELECT W.ID, W.TARIFF, W.MIN_PRICE, WC.COMMISSION
                 FROM WILDBERRIES W JOIN WB_CATEGORIES WC on WC.ID = W.WB_CATEGORIES_ID
                 WHERE W.ID IN (${'?'.repeat(part.length).split('').join()})`,
                        part,
                        true,
                    );
                }),
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

    async getQuantities(goodCodes: string[], t: FirebirdTransaction = null): Promise<Map<string, number>> {
        return new Map(
            (await this.in(goodCodes, t)).map((good) => [good.code.toString(), good.quantity - good.reserve]),
        );
    }

    // Not used. Should be removed.
    async updateCountForService(service: ICountUpdateable, args: any): Promise<number> {
        const serviceGoods = await service.getGoodIds(args);
        if (serviceGoods.goods.size === 0) return 0;
        const goodIds: string[] = skusToGoodIds(Array.from(serviceGoods.goods.keys()));
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
            const sku = percent.offer_id.toString() + '-' + percent.pieces.toString();
            if (!fullSkus.includes(sku)) {
                fullSkus.push(sku);
                if (percent.pieces === 1) fullSkus.push(percent.offer_id.toString());
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

    async generatePercentsForService(service: IPriceUpdateable, skus: string[], available_prices?: Map<string, number>): Promise<GoodPercentDto[]> {
        const { goods, percents, products } = await this.priceCalculationHelper.preparePricesContext(service, skus, this);
        const skuPairs = skus.map(sku => ({
            offer_id: goodCode({ offer_id: sku }),
            pieces: goodQuantityCoeff({ offer_id: sku })
        }));

        const filteredPercents = percents.filter(percent =>
            skuPairs.some(pair =>
                pair.offer_id === percent.offer_id.toString() &&
                pair.pieces === percent.pieces
            )
        );

        return filteredPercents.map((percent: GoodPercentDto) => {
            const product = products.find((p) => {
                const sku = p.getSku();
                return sku === percent.offer_id.toString();
            });
            const {adv_perc, packing_price} = percent;
            const incoming_price = this.priceCalculationHelper.getIncomingPrice(product, goods);
            const available_price = available_prices?.get(product.getSku()) ?? percent.available_price;

            const initialPrice = {
                adv_perc,
                fbs_direct_flow_trans_max_amount: product.getTransMaxAmount(),
                incoming_price,
                available_price,
                offer_id: product.getSku(),
                sales_percent: product.getSalesPercent(),
                sum_pack: packing_price,
                min_perc: 0,
                perc: 0,
                old_perc: 0
            };

            const { min_perc, perc, old_perc } = this.priceCalculationHelper.adjustPercents(
                initialPrice,
                service
            );

            return {
                ...percent,
                perc,
                old_perc,
                min_perc,
                available_price
            };
        });
    }

    async updatePercentsForService(service: IPriceUpdateable, skus: string[], available_prices?: Map<string, number>): Promise<void> {
        const updatedPercents = await this.generatePercentsForService(service, skus, available_prices);
        await Promise.all(updatedPercents.map((percent) => this.setPercents(percent)));
    }

    /**
     * Updates the price for the given service using the provided SKUs, price data, and coefficient calculations.
     *
     * @param {IPriceUpdateable} service - The service interface that supports price update operations.
     * @param {string[]} skus - The list of marketplace SKU identifiers for which the prices need to be updated.
     * @param {Map<string, UpdatePriceDto>} [prices] - An optional map of SKU to price update data (incoming prices).
     * @return {Promise<any>} Returns a promise that resolves with the result of the update operation, or null if no updates were needed.
     */
    async updatePriceForService(service: IPriceUpdateable, skus: string[], prices?: Map<string, UpdatePriceDto>): Promise<any> {
        const { goods, percents, products } = await this.priceCalculationHelper.preparePricesContext(service, skus, this);
        const updatePrices: UpdatePriceDto[] = [];
        products.forEach((product) => {
            const incoming_price = this.priceCalculationHelper.getIncomingPrice(product, goods, prices);
            if (incoming_price !== 0) {
                const gCode = goodCode({ offer_id: product.getSku() });
                const gCoeff = goodQuantityCoeff({ offer_id: product.getSku() });
                const { min_perc, perc, old_perc, adv_perc, packing_price, available_price } = percents.find(
                    (p) => p.offer_id.toString() === gCode && p.pieces === gCoeff,
                ) || {
                    adv_perc: 0,
                    old_perc: this.configService.get<number>('PERC_MAX', 50),
                    perc: this.configService.get<number>('PERC_NOR', 25),
                    min_perc: this.configService.get<number>('PERC_MIN', 15),
                    packing_price: this.configService.get<number>('SUM_PACK', 10),
                    available_price: 0,
                };
                updatePrices.push(
                    calculatePrice(
                        {
                            adv_perc,
                            fbs_direct_flow_trans_max_amount: product.getTransMaxAmount(),
                            incoming_price,
                            available_price,
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
        return updatePrices.length > 0 ? service.updatePrices(updatePrices) : null;
    }

    @Cron('0 0 9-19 * * 1-6', { name: 'checkGoodCount' })
    async checkCounts(): Promise<any[]> {
        const updateByTransactions = await this.cacheManager.get('updateByTransactions');
        if (updateByTransactions) return [];
        const t = await this.pool.getTransaction();
        const res = await t.query('SELECT GOODSCODE FROM GOODSCOUNTCHANGE WHERE CHANGED=1', [], true);
        if (res.length === 0) return;
        this.eventEmitter.emit(
            'counts.changed',
            await this.in(
                res.map((r) => r.GOODSCODE),
                null,
            ),
        );
        await Promise.all(
            chunk(res, 50).map(async (part: any) => {
                const t = await this.pool.getTransaction();
                const codes = part.map((good) => good.GOODSCODE);
                return t.execute(
                    `UPDATE GOODSCOUNTCHANGE SET CHANGED=0 WHERE GOODSCODE IN (${'?'
                        .repeat(codes.length)
                        .split('')
                        .join()})`,
                    codes,
                    true,
                );
            }),
        );
    }
    @OnEvent('counts.changed', { async: true })
    async checkBounds(goods: GoodDto[]): Promise<void> {
        const t = await this.pool.getTransaction();
        const bounds = await t.query(
            'select goodscode, sum(quan) as amount, count(quan) as quan, ' +
                '(select bound_quan_shop from bound_quan where bound_quan.goodscode=pr_meta.goodscode) as bound ' +
                'from pr_meta ' +
                'where (shopoutcode is not null or podbposcode is not null or realpricefcode is not null) ' +
                `and data >= ?  and data <= ? and goodscode in (${'?'
                    .repeat(goods.length)
                    .split('')
                    .join()}) group by goodscode`,
            [DateTime.now().minus({ month: 1 }).toJSDate(), new Date(), ...goods.map((good) => good.code)],
            true,
        );
        bounds.forEach((bound) => {
            const good: GoodDto = find(goods, { code: bound.GOODSCODE });
            const quantity = good.quantity - (good.reserve ?? 0);
            if (quantity < bound.AMOUNT / 2 && bound.QUAN > 1) {
                if (!this.halfStoreMessages.includes(good.code)) {
                    this.eventEmitter.emit('half.store', good, bound);
                    this.halfStoreMessages.push(good.code);
                }
            } else {
                remove(this.halfStoreMessages, (code) => code === good.code);
            }
            if (bound.BOUND !== null && quantity <= bound.BOUND) {
                if (!this.boundCheckMessages.includes(good.code)) {
                    this.eventEmitter.emit('bound.check', good, bound);
                    this.boundCheckMessages.push(good.code);
                }
            } else {
                remove(this.boundCheckMessages, (code) => code === good.code);
            }
        });
    }

    async updateWbCategory(wbCard: WbCardDto): Promise<void> {
        const t = await this.pool.getTransaction();
        await t.execute(
            'UPDATE OR INSERT INTO WB_CATEGORIES (ID, COMMISSION, NAME) VALUES (?, ?, ?) MATCHING (ID)',
            [wbCard.subjectID, wbCard.kgvpMarketplace ?? 25, wbCard.subjectName],
            true,
        );
    }

    async getWbCategoryByName(name: string): Promise<WbCommissionDto> {
        const t = await this.pool.getTransaction();
        const res = await t.query('SELECT * FROM WB_CATEGORIES WHERE NAME = ?', [name], true);
        return res.length > 0
            ? {
                  id: res[0].ID,
                  name: res[0].NAME,
                  commission: res[0].COMMISSION,
              }
            : null;
    }

    /**
     * Обнуляет значение AVAILABLE_PRICE для всех товаров или указанного списка
     */
    async resetAvailablePrice(goodCodes?: string[], t?: FirebirdTransaction): Promise<void> {
        return this.withTransaction(async (transaction) => {
            // Если goodCodes не указан или пустой, обнуляем для всех товаров
            if (!goodCodes || goodCodes.length === 0) {
                await transaction.execute('UPDATE OZON_PERC SET AVAILABLE_PRICE = 0', []);
                return;
            }

            // Размер пакета (максимальное количество кодов в одном запросе)
            const batchSize = 50;

            // Разбиваем список на пакеты
            for (let i = 0; i < goodCodes.length; i += batchSize) {
                const batch = goodCodes.slice(i, i + batchSize);
                const placeholders = batch.map(() => '?').join(',');
                const query = `UPDATE OZON_PERC SET AVAILABLE_PRICE = 0 WHERE GOODSCODE IN (${placeholders})`;

                await transaction.execute(query, batch);
            }
        }, t);
    }
}
