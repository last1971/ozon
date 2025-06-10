import { Injectable, OnModuleInit } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductListResultDto } from './dto/product.list.result.dto';
import { ProductCodeStockDto, ProductCodeUpdateStockResultDto } from './dto/product.code.dto';
import { PostingResultDto } from '../posting/dto/posting.result.dto';
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
import { PostingDto } from '../posting/dto/posting.dto';
import { Environment } from '../env.validation';
import { ConfigService } from '@nestjs/config';
import { ProductFilterDto } from "./dto/product.filter.dto";
import { ProductInfoDto } from "./dto/product.info.dto";
import { GoodServiceEnum } from "../good/good.service.enum";
import { VaultService } from "vault-module/lib/vault.service";
import { ProductListDto } from "./dto/product.list.dto";
import { IProductable } from 'src/interfaces/i.productable';
import { ActionListProduct } from 'src/promos/dto/actionsCandidate.dto';
import { ProductPriceDto } from 'src/price/dto/product.price.dto';

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
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
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
    async orderList(filter: PostingsRequestDto, limit = 100, offset = 0): Promise<PostingResultDto> {
        return this.ozonApiService.method('/v3/posting/fbs/list', { filter, limit, offset });
    }
    async orderFboList(request: PostingsFboRequestDto): Promise<{ result: PostingDto[] }> {
        return this.ozonApiService.method('/v2/posting/fbo/list', request);
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
    async setPrice(prices: UpdatePricesDto): Promise<any> {
        return this.ozonApiService.method('/v1/product/import/prices', prices);
    }
    async getTransactionList(filter: TransactionFilterDto, page = 1): Promise<any> {
        const res = await this.ozonApiService.method('/v3/finance/transaction/list', { filter, page, page_size: 1000 });
        const response: TransactionDto[] = res.result.operations.map(
            (operation: any): TransactionDto => ({
                amount: operation.amount,
                posting_number: operation.posting.posting_number,
            }),
        );
        if (page !== res.result.page_count) {
            response.concat(await this.getTransactionList(filter, page + 1));
        }
        return response;
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

}
