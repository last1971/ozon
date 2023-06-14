import { Injectable } from '@nestjs/common';
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

@Injectable()
export class ProductService {
    constructor(private ozonApiService: OzonApiService) {}
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
}
