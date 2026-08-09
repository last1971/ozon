import { Injectable, OnModuleInit } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductListResultDto } from './dto/product.list.result.dto';
import { ProductCodeStockDto, ProductCodeUpdateStockResultDto } from './dto/product.code.dto';
import { PostingsDto } from '../posting/dto/postings.dto';
import { PostingsRequestDto } from '../posting/dto/postings.request.dto';
import { ProductPriceListDto } from '../price/dto/product.price.list.dto';
import { PriceRequestDto } from '../price/dto/price.request.dto';
import { ProductVisibility } from './product.visibility';
import { chunk, isArray } from 'lodash';
import { UpdatePricesDto } from '../price/dto/update.price.dto';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { StockType } from './stock.type';
import { PostingsFboRequestDto } from '../posting.fbo/dto/postings.fbo.request.dto';
import { ConfigService } from '@nestjs/config';
import { ProductFilterDto } from "./dto/product.filter.dto";
import { ProductInfoDto } from "./dto/product.info.dto";
import { GoodServiceEnum } from "../good/good.service.enum";
import { VaultService } from "vault-module/lib/vault.service";
import { ProductListDto } from "./dto/product.list.dto";
import { IProductable } from 'src/interfaces/i.productable';
import { ActionListProduct } from 'src/promos/dto/actionsCandidate.dto';
import { ProductPriceDto } from 'src/price/dto/product.price.dto';
import { UpdateAttributesBodyDto, UpdateAttributesResponseDto } from './dto/update.attributes.dto';
import { BuyoutDto } from '../posting/dto/buyout.dto';
import { AccrualTypeDto, AccrualByDayResultDto, PayoutPeriodDto } from '../posting/dto/accrual.dto';
import { Cacheable } from 'nestjs-cacheable';

@Injectable()
export class ProductService extends ICountUpdateable implements OnModuleInit, IProductable {
    private warehouseId: number;
    constructor(
        private ozonApiService: OzonApiService,
        private configService: ConfigService,
        private vaultService: VaultService,
    ) {
        super();
    }
    async onModuleInit(): Promise<void> {
        const ozon = await this.vaultService.get('ozon');
        this.warehouseId = ozon.STORE as number;
    }
    // вроде более не использую
    async list(last_id = '', limit = 100, filter: ProductFilterDto = new ProductFilterDto()): Promise<ProductListResultDto> {
        return this.ozonApiService.method('/v3/product/list', { filter, last_id, limit });
    }
    async infoList(offer_id: string[]): Promise<ProductInfoDto[]> {
        const res = await this.ozonApiService.method('/v3/product/info/list', { offer_id });
        return res?.items.map((item: any): ProductInfoDto => {
            const { stocks } = item.stocks;
            const fbs = stocks.find((stock: any) => stock.source === StockType.FBS);
            const fbo = stocks.find((stock: any) => stock.source === StockType.FBO);
            return{
                sku: item.offer_id,
                barCode: item.barcodes[0],
                remark: item.name,
                primaryImage: item.primary_image,
                id: item.id,
                goodService: GoodServiceEnum.OZON,
                fbsCount: (fbs?.present || 0) - (fbs?.reserved || 0),
                fboCount: (fbo?.present || 0) - (fbo?.reserved || 0),
                typeId: item.type_id,
                volumeWeight: item.volume_weight,
            }});
    }

    /**
     * Retrieves a list of products with pagination and filtering capabilities, including a total count.
     *
     * @param {string} [cursor=''] The pagination cursor for fetching the next set of products.
     * @param {number} [limit=100] The maximum number of products to be fetched in a single request.
     * @param {Object} [filter={}] An optional filter object to specify additional criteria for retrieving products.
     * @return {Promise<ProductListDto>} A promise resolving to a ProductListDto object containing the list of products and the total count.
     */
    async listWithCount(cursor = '', limit = 100, filter = {}): Promise<ProductListDto> {
        return this.ozonApiService.method('/v4/product/info/stocks', { filter, limit, cursor });
    }

    async getFreeProductCount(productIds: number[]): Promise<{ id: number; count: number }[]> {
        const limit = 100;
        const productCounts: { id: number; count: number }[] = [];
        for (const ids of chunk(productIds, limit)) {
            // Получаем данные о складах для текущего чанка
            const res = await this.listWithCount('', limit, { product_id: ids });

            // Обрабатываем элементы из ответа
            res.items.forEach((item) => {
                const totalStock = (item.stocks || []).reduce(
                    (sum, stock) => sum + (stock.present || 0) - (stock.reserved || 0),
                    0
                );
                productCounts.push({
                    id: item.product_id ?? 0, // Используем product_id, если он определен
                    count: totalStock,
                });
            });
        }
        return productCounts;
    }
    async updateCount(stocks: ProductCodeStockDto[]): Promise<ProductCodeUpdateStockResultDto> {
        return this.ozonApiService.method(
            '/v2/products/stocks',
            {
                stocks: stocks.map(
                    (stock) => ({ ...stock, warehouse_id: this.warehouseId })
                )
            }
        );
    }
    // v4 вместо v3 (v3 отключается 31.08.2026): ответ плоский, offset сломан — только cursor.
    async orderList(filter: PostingsRequestDto, limit = 100, cursor = ''): Promise<PostingsDto> {
        return this.ozonApiService.method('/v4/posting/fbs/list', { filter, limit, cursor });
    }
    // v3 вместо v2 (v2 отключается 31.08.2026): ответ плоский, курсор вместо offset, limit ≤ 100.
    async orderFboList(request: PostingsFboRequestDto): Promise<PostingsDto> {
        return this.ozonApiService.method('/v3/posting/fbo/list', request);
    }
    async getPrices(priceRequest: PriceRequestDto): Promise<ProductPriceListDto> {
        const options = {
            filter: {
                product_id: priceRequest.product_id || null,
                offer_id: priceRequest.offer_id
                    ? isArray(priceRequest.offer_id)
                        ? priceRequest.offer_id
                        : [priceRequest.offer_id]
                    : null,
                visibility: priceRequest.visibility || ProductVisibility.ALL,
            },
            limit: priceRequest.limit,
            cursor: priceRequest.cursor || null,
        };
        const res = await this.ozonApiService.method('/v5/product/info/prices', options);
        return res || { items: [], cursor: '' };
    }
    async   setPrice(prices: UpdatePricesDto): Promise<any> {
        const batchSize = 1000;
        const results = [];

        for (const batch of chunk(prices.prices, batchSize)) {
            const batchRequest: UpdatePricesDto = { prices: batch };
            const result = await this.ozonApiService.method('/v1/product/import/prices', batchRequest);
            results.push(...result.result);
        }

        return { result: results };
    }

    async getGoods(args: any, stockTypes = [StockType.FBS, StockType.FBO]): Promise<any> {
        const products = await this.listWithCount(args);
        const goods = new Map<string, number>();
        (products.items || []).forEach((product) => {
            const stock = product.stocks.find((stock) => stockTypes.includes(stock.type));
            goods.set(product.offer_id, product.stocks.length > 0 ? stock.present - stock.reserved : 0);
        });
        return { goods, nextArgs: products.cursor };
    }

    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        return this.getGoods(args, [StockType.FBS]);
    }
    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        const updateGoods: ProductCodeStockDto[] = [];
        goods.forEach((stock, offer_id) => {
            updateGoods.push({ offer_id, stock });
        });
        let totalUpdated = 0;

        // Используем lodash для разбиения массива
        const chunks = chunk(updateGoods, 100);

        for (const chunk of chunks) {
            const result = await this.updateCount(chunk);
            const response = result.result || [];
            totalUpdated += response.length; // Увеличиваем счетчик успешно обновленных товаров
        }

        return totalUpdated;

    }
    async getStoreList(): Promise<any> {
        return this.ozonApiService.method('/v1/warehouse/list', {});
    }

    @Cacheable({ namespace: 'ozon:tree', ttl: 86400 })
    async getCategoryTree(): Promise<any> {
        return this.ozonApiService.method('/v1/description-category/tree', {});
    }

    @Cacheable({
        key: (desc_cat_id: number, type_id: number) => `${desc_cat_id}:${type_id}`,
        namespace: 'ozon:cat-attrs',
        ttl: 86400,
    })
    async getCategoryAttributes(desc_cat_id: number, type_id: number): Promise<any> {
        return this.ozonApiService.method('/v1/description-category/attribute', {
            description_category_id: desc_cat_id,
            language: 'DEFAULT',
            type_id,
        });
    }

    @Cacheable({
        key: (attr_id: number, desc_cat_id: number, type_id: number) => `${attr_id}:${desc_cat_id}:${type_id}`,
        namespace: 'ozon:attr-vals',
        ttl: 86400,
    })
    async getCategoryAttributeValues(
        attribute_id: number,
        desc_cat_id: number,
        type_id: number,
    ): Promise<any[]> {
        const allValues: any[] = [];
        let lastValueId = 0;
        let hasNext = true;
        while (hasNext) {
            const resp = await this.ozonApiService.method('/v1/description-category/attribute/values', {
                attribute_id,
                description_category_id: desc_cat_id,
                language: 'DEFAULT',
                last_value_id: lastValueId,
                limit: 5000,
                type_id,
            });
            if (!resp?.result?.length) break;
            allValues.push(...resp.result);
            hasNext = resp.has_next === true;
            if (hasNext) lastValueId = resp.result[resp.result.length - 1].id;
        }
        return allValues;
    }

    /** Точечный поиск значений атрибута категории по подстроке (не тянет весь словарь). */
    @Cacheable({
        key: (attr_id: number, desc_cat_id: number, type_id: number, value: string) =>
            `${attr_id}:${desc_cat_id}:${type_id}:${value}`,
        namespace: 'ozon:attr-vals-search',
        ttl: 86400,
    })
    async searchCategoryAttributeValues(
        attribute_id: number,
        desc_cat_id: number,
        type_id: number,
        value: string,
        limit = 50,
    ): Promise<any[]> {
        const resp = await this.ozonApiService.method('/v1/description-category/attribute/values/search', {
            attribute_id,
            description_category_id: desc_cat_id,
            type_id,
            value,
            limit,
        });
        return resp?.result ?? [];
    }

    /**
     * Получает цены для списка товаров акции с поддержкой постраничной выборки.
     *
     * @param {ActionListProduct[]} actionProducts - Список товаров акции, для которых требуется получить цены.
     * @param {number} [limit=100] - Максимальное количество товаров, обрабатываемых за один запрос.
     * @returns {Promise<{ id: number; price: ProductPriceDto['price'] }[]>} Промис, который возвращает массив объектов с идентификаторами товаров и их ценами.
     */
    async getProductsPrices(
        actionProducts: ActionListProduct[],
        limit: number = 100,
    ): Promise<{ id: number; price: ProductPriceDto['price'] }[]> {
        const productPrices: { id: number; price: ProductPriceDto['price'] }[] = [];
        const pages = Math.ceil(actionProducts.length / limit);
        for (let i = 0; i < pages; i++) {
            const chunk = actionProducts.slice(i * limit, (i + 1) * limit);
            const priceRequest: PriceRequestDto = {
                product_id: chunk.map((product) => product.id),
                visibility: ProductVisibility.ALL,
                limit,
            };
            const pricesChunk = await this.getPrices(priceRequest);
            productPrices.push(...pricesChunk.items.map((item) => ({ id: item.product_id, price: item.price })));
        }
        return productPrices;
    }

    async updateAttributes(body: UpdateAttributesBodyDto): Promise<UpdateAttributesResponseDto[]> {
        const offerIds = body.offer_ids?.length ? body.offer_ids : this.skuList;
        const items = offerIds.map(offer_id => ({ offer_id, attributes: body.attributes }));
        const results: UpdateAttributesResponseDto[] = [];

        for (const batch of chunk(items, 100)) {
            const result = await this.ozonApiService.method('/v1/product/attributes/update', { items: batch });
            results.push(result);
        }

        return results;
    }

    @Cacheable({
        key: (offer_id: string) => offer_id,
        namespace: 'ozon:product-attrs',
        ttl: 86400,
    })
    async getProductAttributes(offer_id: string): Promise<any> {
        const res = await this.ozonApiService.method('/v4/product/info/attributes', {
            filter: { offer_id: [offer_id] },
            limit: 1,
        });
        return res?.result?.[0] || null;
    }

    async getTaskInfo(taskId: number): Promise<any> {
        return this.ozonApiService.method('/v1/product/import/info', { task_id: taskId });
    }

    /**
     * Начисления за ОДИН день. Замена /v3/finance/transaction/list (умирает 08.09.2026).
     * Пагинация внутри дня — по last_id; страница без last_id читается первой.
     */
    async getAccrualsByDay(date: string, lastId = 0): Promise<AccrualByDayResultDto> {
        const body: { date: string; last_id?: number } = { date };
        if (lastId) body.last_id = lastId;
        const res = await this.ozonApiService.method('/v1/finance/accrual/by-day', body);
        return { accruals: res?.accruals || [], last_id: res?.last_id || 0 };
    }

    /** Словарь видов начислений: без него в письме вместо услуги виден лишь код. */
    async getAccrualTypes(): Promise<AccrualTypeDto[]> {
        const res = await this.ozonApiService.method('/v1/finance/accrual/types', {});
        return res?.accrual_types || [];
    }

    /** Недельные периоды выплат: по ним берётся окно, а не по «последним N дням». */
    async getPayoutPeriods(dateFrom: string, dateTo: string): Promise<PayoutPeriodDto[]> {
        const res = await this.ozonApiService.method('/v1/finance/cash-flow-statement/list', {
            date: { from: dateFrom, to: dateTo },
            page: 1,
            page_size: 100,
            with_details: false,
        });
        return res?.result?.cash_flows || [];
    }


}
