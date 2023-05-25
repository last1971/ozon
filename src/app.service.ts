import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductService } from './product/product.service';
import { GOOD_SERVICE, IGood } from './interfaces/IGood';

@Injectable()
export class AppService {
    constructor(private productService: ProductService, @Inject(GOOD_SERVICE) private goodService: IGood) {}
    getHello(): string {
        return 'Hello World!';
    }
    @Cron('0 49 14 * * *')
    async checkGoodCount(last_id = ''): Promise<void> {
        const products = await this.productService.listWithCount(last_id);
        console.log(products.result.items.map((item) => item.offer_id));
        const goods = await this.goodService.in(products.result.items.map((item) => item.offer_id));
        console.log(goods);
    }
}
