import { Inject, Injectable, Logger } from '@nestjs/common';
import { IGood } from '../interfaces/IGood';
import { GoodDto } from '../good/dto/good.dto';
import { FIREBIRD } from '../firebird/firebird.module';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { GoodPriceDto } from '../good/dto/good.price.dto';
import { GoodPercentDto } from '../good/dto/good.percent.dto';
import {
    calculatePrice,
    getPieces,
    goodCode,
    goodQuantityCoeff,
    isSkuMatch,
    productQuantity,
    skusToGoodIds,
    StringToIOfferIdableAdapter,
} from '../helpers';
import { ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { GoodAvitoDto } from '../good/dto/good.avito.dto';
import { chunk, find, flatten, snakeCase, toUpper } from 'lodash';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { Cache } from '@nestjs/cache-manager';
import { WbCommissionDto } from '../wb.card/dto/wb.commission.dto';
import { WithTransactions } from '../helpers/mixin/transaction.mixin';
import { PriceCalculationHelper } from '../helpers/price/price.calculation.helper';

@Injectable()
export class Trade2006GoodService extends WithTransactions(class {}) implements IGood {

    private storageTable: string;
    private readonly logger = new Logger(Trade2006GoodService.name);
    constructor(
        @Inject(FIREBIRD) private pool: FirebirdPool,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
        private cacheManager: Cache,
        private priceCalculationHelper: PriceCalculationHelper,
    ) {
        super();
        this.storageTable = configService.get<string>('STORAGE_TYPE', 'SHOPSKLAD').toUpperCase();
    }

    async in(codes: string[], t: FirebirdTransaction = null): Promise<GoodDto[]> {
        if (codes.length === 0) return [];
        const transaction = t ?? (await this.pool.getTransaction());
        const response: any[] = await transaction.query(
            `
            SELECT
                GOODS.GOODSCODE,
                ${this.storageTable}.QUAN,
                (
                    SELECT SUM(QUANSHOP) + SUM(QUANSKLAD)
                    FROM RESERVEDPOS
                    WHERE GOODS.GOODSCODE = RESERVEDPOS.GOODSCODE
                ) AS RES,
                NAME.NAME AS NAME
            FROM GOODS
                JOIN ${this.storageTable} ON GOODS.GOODSCODE = ${this.storageTable}.GOODSCODE
                JOIN NAME ON GOODS.NAMECODE = NAME.NAMECODE
            WHERE GOODS.GOODSCODE IN (${codes.map(() => '?').join(',')})
            `,
            codes,
            !t,
        );
        return response.map(
            (item): GoodDto => ({ code: item.GOODSCODE, quantity: item.QUAN, reserve: item.RES, name: item.NAME }),
        );
    }

    async prices(codes: string[], t: FirebirdTransaction = null): Promise<GoodPriceDto[]> {
        if (codes.length === 0) return [];

        return this.withTransaction(async (transaction) => {
            const allResults: GoodPriceDto[] = [];
            const batchSize = 50; // Как в resetAvailablePrice
            const inCode = this.storageTable === 'SHOPSKLAD' ? 'shopincode' : 'skladincode';

            // Разбиваем на батчи
            for (let i = 0; i < codes.length; i += batchSize) {
                const batch = codes.slice(i, i + batchSize);
                const placeholders = batch.map(() => '?').join(',');

                const response: any[] = await transaction.query(
                    `SELECT
                        g.goodscode,
                        n.name,
                        CASE
                            WHEN s.quan - COALESCE(r.res, 0) > 0 THEN COALESCE(
                                (
                                    SELECT SUM(t.ost * t.price) / NULLIF(SUM(t.ost), 0)
                                    FROM (
                                        SELECT
                                            pm.price,
                                            pm.quan - COALESCE((SELECT SUM(f.quan) FROM fifo_t f WHERE f.pr_meta_in_id = pm.id), 0) AS ost
                                        FROM pr_meta pm
                                        WHERE pm.goodscode = g.goodscode
                                            AND pm.${inCode} IS NOT NULL
                                            AND COALESCE((SELECT SUM(f.quan) FROM fifo_t f WHERE f.pr_meta_in_id = pm.id), 0) < pm.quan
                                    ) t
                                ),
                                (SELECT MAX(AVAILABLE_PRICE) FROM OZON_PERC WHERE GOODSCODE = g.GOODSCODE),
                                (SELECT FIRST 1 pm2.price
                                    FROM pr_meta pm2
                                    WHERE pm2.goodscode = g.goodscode AND pm2.${inCode} IS NOT NULL
                                    ORDER BY pm2.data DESC),
                                1
                            )
                            ELSE NULL
                        END AS pric
                    FROM goods g
                    JOIN name n ON g.namecode = n.namecode
                    JOIN ${this.storageTable} s ON s.goodscode = g.goodscode
                    LEFT JOIN (
                        SELECT goodscode, SUM(QUANSHOP) + SUM(QUANSKLAD) AS res
                        FROM RESERVEDPOS
                        GROUP BY goodscode
                    ) r ON r.goodscode = g.goodscode
                    WHERE g.goodscode IN (${placeholders})`,
                    batch,
                    false
                );

                const batchResults = response.map(
                    (good: any): GoodPriceDto => ({
                        code: good.GOODSCODE,
                        name: good.NAME,
                        price: good.PRIC,
                    })
                );

                allResults.push(...batchResults);
            }

            return allResults;
        }, t);
    }
    async getPerc(codes: string[], t: FirebirdTransaction = null): Promise<GoodPercentDto[]> {
        if (codes.length === 0) return [];

        return this.withTransaction(async (transaction) => {
            const allResults: GoodPercentDto[] = [];
            const batchSize = 50; // Как в других методах

            // Разбиваем на батчи
            for (let i = 0; i < codes.length; i += batchSize) {
                const batch = codes.slice(i, i + batchSize);
                const placeholders = batch.map(() => '?').join(',');

                const pecents = await transaction.query(
                    `select * from ozon_perc where goodscode in (${placeholders})`,
                    batch,
                    false
                );

                const batchResults = pecents.map((percent: any) => ({
                    offer_id: percent.GOODSCODE,
                    pieces: percent.PIECES,
                    perc: percent.PERC_NOR,
                    adv_perc: percent.PERC_ADV,
                    old_perc: percent.PERC_MAX,
                    min_perc: percent.PERC_MIN,
                    packing_price: percent.PACKING_PRICE ?? this.configService.get<number>('SUM_PACK', 10),
                    available_price: percent.AVAILABLE_PRICE,
                }));

                allResults.push(...batchResults);
            }

            return allResults;
        }, t);
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
                getPieces(perc),
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

    async setAvitoData(data: GoodAvitoDto, t: FirebirdTransaction = null): Promise<void> {
        return this.withTransaction(async (transaction) => {
            await transaction.execute(
                'UPDATE OR INSERT INTO AVITO_GOOD (ID, GOODSCODE, COEFF, COMMISSION) VALUES (?, ?, ?, ?) MATCHING (ID)',
                [data.id, data.goodsCode, data.coeff, data.commission],
                false,
            );
        }, t);
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

    /**
     * Fetches data from the Avito database for the given IDs.
     * The data is retrieved in chunks to optimize the query performance
     * and then flattened into a single array of results.
     *
     * @param {string[]} ids - An array of IDs corresponding to the Avito data to be retrieved.
     * @return {Promise<GoodAvitoDto[]>} A promise that resolves to an array of GoodAvitoDto objects containing the retrieved data.
     */
    async getAvitoData(ids: string[]): Promise<GoodAvitoDto[]> {
        const avitoData: any[] = flatten(
            await Promise.all(
                chunk(ids, 50).map(async (part: string[]) => {
                    return this.withTransaction(async (transaction) => {
                        return transaction.query(
                            `SELECT ID, GOODSCODE, COEFF, COMMISSION
                     FROM AVITO_GOOD
                     WHERE ID IN (${'?'.repeat(part.length).split('').join()})`,
                            part,
                            false,
                        );
                    });
                }),
            ),
        );
        return avitoData.map(
            (data): GoodAvitoDto => ({
                id: data.ID,
                goodsCode: data.GOODSCODE,
                coeff: data.COEFF,
                commission: data.COMMISSION,
            }),
        );
    }

    async getAllAvitoGoods(): Promise<GoodAvitoDto[]> {
        return this.withTransaction(async (transaction) => {
            const result = await transaction.query('SELECT * FROM AVITO_GOOD', [], false);
            return result.map((row: any) => ({
                id: row.ID,
                goodsCode: row.GOODSCODE,
                coeff: row.COEFF,
                commission: row.COMMISSION,
            }));
        });
    }

    async getQuantities(goodCodes: string[], t: FirebirdTransaction = null): Promise<Map<string, number>> {
        return new Map(
            (await this.in(goodCodes, t)).map((good) => [good.code.toString(), good.quantity - good.reserve]),
        );
    }

    // Not used. Should be removed.
    /*
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
    */

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

    async generatePercentsForService(
        service: IPriceUpdateable,
        skus: string[],
        goodPercentsDto?: Map<string, Partial<GoodPercentDto>>,
    ): Promise<GoodPercentDto[]> {
        const { goods, percents, products } = await this.priceCalculationHelper.preparePricesContext(
            service,
            skus,
            this,
        );

        const filteredPercents = percents.filter((percent) =>
            products.some(
                (product) =>
                    isSkuMatch(product.getSku(), percent.offer_id.toString(), percent.pieces) &&
                    this.priceCalculationHelper.getIncomingPrice(product, goods) > 0,
            ),
        );

        return filteredPercents.map((percent: GoodPercentDto) => {
            const product = products.find((p) => isSkuMatch(p.getSku(), percent.offer_id.toString(), percent.pieces));
            const sku = product.getSku();
            const dto = goodPercentsDto?.get(sku);

            const adv_perc = dto?.adv_perc ?? percent.adv_perc;
            const available_price = dto?.available_price ?? percent.available_price;
            const packing_price = dto?.packing_price ?? percent.packing_price;

            const initialPrice = {
                adv_perc,
                fbs_direct_flow_trans_max_amount: product.getTransMaxAmount(),
                incoming_price: this.priceCalculationHelper.getIncomingPrice(product, goods),
                available_price,
                offer_id: sku,
                sales_percent: product.getSalesPercent(),
                sum_pack: packing_price,
                min_perc: 0,
                perc: 0,
                old_perc: 0,
            };

            const { min_perc, perc, old_perc } = this.priceCalculationHelper.adjustPercents(initialPrice, service);

            return {
                ...percent,
                perc,
                old_perc,
                min_perc,
                adv_perc,
                available_price,
                packing_price,
            };
        });
    }

    async updatePercentsForService(
        service: IPriceUpdateable,
        skus: string[],
        goodPercentsDto?: Map<string, Partial<GoodPercentDto>>,
    ): Promise<void> {
        const updatedPercents = await this.generatePercentsForService(service, skus, goodPercentsDto);
        // Убираем дубли по GOODSCODE и PIECES, оставляя только первый
        const seen = new Set<string>();
        const uniquePercents = updatedPercents.filter((percent) => {
            const key = `${percent.offer_id}_${percent.pieces}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        for (const batch of chunk(uniquePercents, 50)) {
            await Promise.all(
                batch.map(async (percent) => {
                    try {
                        await this.setPercents(percent);
                    } catch (err) {
                        this.logger?.error?.(
                            `setPercents error for GOODSCODE=${percent.offer_id}, PIECES=${percent.pieces}: ${err?.message}`,
                            err?.stack,
                        );
                        // Продолжаем с остальными
                    }
                })
            );
        }
    }

    /**
     * Updates the price for the given service using the provided SKUs, price data, and coefficient calculations.
     *
     * @param {IPriceUpdateable} service - The service interface that supports price update operations.
     * @param {string[]} skus - The list of marketplace SKU identifiers for which the prices need to be updated.
     * @param {Map<string, UpdatePriceDto>} [prices] - An optional map of SKU to price update data (incoming prices).
     * @return {Promise<any>} Returns a promise that resolves with the result of the update operation, or null if no updates were needed.
     */
    async updatePriceForService(
        service: IPriceUpdateable,
        skus: string[],
        prices?: Map<string, UpdatePriceDto>,
    ): Promise<any> {
        const { goods, percents, products } = await this.priceCalculationHelper.preparePricesContext(
            service,
            skus,
            this,
        );
        const updatePrices: UpdatePriceDto[] = [];

        for (const product of products) {
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

                const priceData = {
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
                };

                updatePrices.push(calculatePrice(priceData, service.getObtainCoeffs()));
            }
        }
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
            `SELECT
                goodscode,
                sum(quan) as amount,
                count(quan) as quan,
                (SELECT bound_quan_shop FROM bound_quan WHERE bound_quan.goodscode = pr_meta.goodscode) as bound
            FROM pr_meta
            WHERE (shopoutcode IS NOT NULL OR podbposcode IS NOT NULL OR realpricefcode IS NOT NULL)
                AND data >= ?
                AND data <= ?
                AND goodscode IN (${goods.map(() => '?').join(',')})
            GROUP BY goodscode`,
            [DateTime.now().minus({ month: 1 }).toJSDate(), new Date(), ...goods.map((good) => good.code)],
            true,
        );
        for (const bound of bounds) {
            const good: GoodDto = find(goods, { code: bound.GOODSCODE });
            const quantity = good.quantity - (good.reserve ?? 0);
            const halfStoreKey = `half_store:${good.code}`;
            const boundCheckKey = `bound_check:${good.code}`;
            
            if (quantity < bound.AMOUNT / 2 && bound.QUAN > 1) {
                if (!(await this.cacheManager.get(halfStoreKey))) {
                    this.eventEmitter.emit('half.store', good, bound);
                    await this.cacheManager.set(halfStoreKey, true);
                }
            } else {
                await this.cacheManager.del(halfStoreKey);
            }
            
            if (bound.BOUND !== null && quantity <= bound.BOUND) {    
                if (!(await this.cacheManager.get(boundCheckKey))) {
                    this.eventEmitter.emit('bound.check', good, bound);
                    await this.cacheManager.set(boundCheckKey, true);
                }
            } else {
                await this.cacheManager.del(boundCheckKey);
            }
        }
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
