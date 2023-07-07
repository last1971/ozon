import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductService } from './product/product.service';
import { GOOD_SERVICE, IGood } from './interfaces/IGood';
import { StockType } from './product/stock.type';
import { ProductCodeStockDto, ProductCodeUpdateStockDto } from './product/dto/product.code.dto';
import { goodCode, goodQuantityCoeff, productQuantity } from './helpers';
import { IInvoice, INVOICE_SERVICE } from './interfaces/IInvoice';
import { PriceService } from './price/price.service';

@Injectable()
export class AppService {
    private logger = new Logger(AppService.name);
    constructor(
        private productService: ProductService,
        private priceService: PriceService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
    ) {}
    getHello(): string {
        return 'Hello World!';
    }
    @Cron('0 0 9-19 * * 1-6', { name: 'checkGoodCount' })
    async checkGoodCount(last_id = ''): Promise<ProductCodeUpdateStockDto[]> {
        const products = await this.productService.listWithCount(last_id);
        const goodCodes = (products.result?.items || []).map((item) => goodCode(item));
        const goods = new Map(
            (await this.goodService.in(goodCodes)).map((good) => [good.code.toString(), good.quantity - good.reserve]),
        );
        const updateCount = (products.result?.items || [])
            .filter((item) => {
                const stock = item.stocks.find((stock) => stock.type === StockType.FBS);
                return (
                    item.stocks.length > 0 &&
                    stock.present - stock.reserved !==
                        productQuantity(goods.get(goodCode(item)), goodQuantityCoeff(item))
                );
            })
            .map(
                (item): ProductCodeStockDto => ({
                    offer_id: item.offer_id,
                    product_id: item.product_id,
                    stock: productQuantity(goods.get(goodCode(item)), goodQuantityCoeff(item)),
                }),
            );
        const result = await this.productService.updateCount(updateCount);
        let response = result.result || [];
        if (response.length > 0) {
            this.logger.log(
                `Update quantity for ${response.length} goods with ${
                    response.filter((item) => !item.updated).length
                } errors.`,
            );
        }
        if (products.result && products.result.last_id !== '') {
            response = response.concat(await this.checkGoodCount(products.result.last_id));
        } else {
            this.logger.log('Goods quantity updating finished');
        }
        return response;
    }
}
