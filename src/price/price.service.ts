import { Injectable } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PriceRequestDto } from './dto/price.request.dto';

@Injectable()
export class PriceService {
    constructor(private product: ProductService) {}
    async list(priceRequest: PriceRequestDto): Promise<any> {}
}
