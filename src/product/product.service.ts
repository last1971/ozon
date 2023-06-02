import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductListResultDto } from './dto/product.list.result.dto';
import { ProductCodeStockDto, ProductCodeUpdateStockResultDto } from './dto/product.code.dto';
import { PostingResultDto } from './dto/posting.result.dto';
import { PostingsRequestDto } from './dto/postings.request.dto';

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
}
