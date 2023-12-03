import { Injectable, OnModuleInit } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductListResultDto } from './dto/product.list.result.dto';
import { ProductCodeStockDto, ProductCodeUpdateStockResultDto } from './dto/product.code.dto';
import { PostingResultDto } from '../posting/dto/posting.result.dto';
import { PostingsRequestDto } from '../posting/dto/postings.request.dto';
import { ProductPriceListDto } from '../price/dto/product.price.list.dto';
import { PriceRequestDto } from '../price/dto/price.request.dto';
import { ProductVisibility } from './product.visibility';
import { isArray } from 'lodash';
import { UpdatePricesDto } from '../price/dto/update.price.dto';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { TransactionDto } from '../posting/dto/transaction.dto';
import { GoodCountsDto, ICountUpdateable } from '../interfaces/ICountUpdatebale';
import { StockType } from './stock.type';
import { PostingsFboRequestDto } from '../posting.fbo/dto/postings.fbo.request.dto';
import { PostingDto } from '../posting/dto/posting.dto';
import { Environment } from '../env.validation';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProductService extends ICountUpdateable implements OnModuleInit {
    constructor(
        private ozonApiService: OzonApiService,
        private configService: ConfigService,
    ) {
        super();
    }
    async onModuleInit(): Promise<void> {
        await this.loadSkuList(this.configService.get<Environment>('NODE_ENV') === 'production');
    }
    async list(last_id = '', limit = 100): Promise<ProductListResultDto> {
        return this.ozonApiService.method('/v2/product/list', { last_id, limit });
    }
    async listWithCount(last_id = '', limit = 100): Promise<ProductListResultDto> {
        return this.ozonApiService.method('/v3/product/info/stocks', { filter: {}, limit, last_id });
    }
    async updateCount(stocks: ProductCodeStockDto[]): Promise<ProductCodeUpdateStockResultDto> {
        return this.ozonApiService.method('/v1/product/import/stocks', { stocks });
    }
    async orderList(filter: PostingsRequestDto, limit = 100): Promise<PostingResultDto> {
        return this.ozonApiService.method('/v3/posting/fbs/list', { filter, limit });
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
            last_id: priceRequest.last_id || null,
        };
        const res = await this.ozonApiService.method('/v4/product/info/prices', options);
        return res?.result || { items: [], last_id: '' };
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

    async getGoodIds(args: any): Promise<GoodCountsDto<number>> {
        const products = await this.listWithCount(args);
        const goods = new Map<string, number>();
        (products.result?.items || []).forEach((product) => {
            const stock = product.stocks.find((stock) => stock.type === StockType.FBS);
            goods.set(product.offer_id, product.stocks.length > 0 ? stock.present - stock.reserved : 0);
        });
        return { goods, nextArgs: products?.result.last_id };
    }
    async updateGoodCounts(goods: Map<string, number>): Promise<number> {
        const updateGoods: ProductCodeStockDto[] = [];
        goods.forEach((stock, offer_id) => {
            updateGoods.push({ offer_id, stock });
        });
        const result = await this.updateCount(updateGoods);
        const response = result.result || [];
        return response.length;
    }
}
