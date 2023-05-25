import { Injectable } from '@nestjs/common';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ProductListResultDto } from './dto/product.list.result.dto';

@Injectable()
export class ProductService {
    constructor(private ozonApiService: OzonApiService) {}
    async list(last_id = '', limit = 100): Promise<ProductListResultDto> {
        return this.ozonApiService.method('/v2/product/list', { last_id, limit });
    }
    async listWithCount(last_id = '', limit = 100): Promise<ProductListResultDto> {
        return this.ozonApiService.method('/v3/product/info/stocks', { filter: {}, limit, last_id });
    }
}
