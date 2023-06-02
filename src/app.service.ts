import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductService } from './product/product.service';
import { GOOD_SERVICE, IGood } from './interfaces/IGood';
import { StockType } from './product/stock.type';
import { ProductCodeStockDto, ProductCodeUpdateStockDto } from './product/dto/product.code.dto';
import { goodCode, goodQuantityCoeff, productQuantity } from './helpers';
import { IInvoice, INVOICE_SERVICE } from './interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';

@Injectable()
export class AppService {
    constructor(
        private productService: ProductService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
    ) {}
    getHello(): string {
        return 'Hello World!';
    }
    @Cron('0 0 0 * * *')
    async checkGoodCount(last_id = ''): Promise<ProductCodeUpdateStockDto[]> {
        const products = await this.productService.listWithCount(last_id);
        const goodCodes = products.result.items.map((item) => goodCode(item));
        const goods = new Map(
            (await this.goodService.in(goodCodes)).map((good) => [good.code.toString(), good.quantity]),
        );
        const updateCount = products.result.items
            .filter(
                (item) =>
                    item.stocks.length > 0 &&
                    item.stocks.find((stock) => stock.type === StockType.FBS).present !==
                        productQuantity(goods.get(goodCode(item)), goodQuantityCoeff(item)),
            )
            .map(
                (item): ProductCodeStockDto => ({
                    offer_id: item.offer_id,
                    product_id: item.product_id,
                    stock: productQuantity(goods.get(goodCode(item)), goodQuantityCoeff(item)),
                }),
            );
        const result = await this.productService.updateCount(updateCount);
        let response = result.result;
        if (products.result.last_id !== '') {
            response = response.concat(await this.checkGoodCount(products.result.last_id));
        }
        return response;
    }

    async checkNewOrders(): Promise<void> {
        const postings = await this.productService.orderList({
            since: DateTime.now().startOf('day').toJSDate(),
            to: DateTime.now().endOf('day').toJSDate(),
            status: 'awaiting_packaging', // 'awaiting_deliver',
        });
        for (const posting of postings.result.postings) {
            if (!(await this.invoiceService.isExists(posting.posting_number))) {
                const buyerId = this.configService.get<number>('BUYER_ID', 24416);
                await this.invoiceService.create({
                    buyerId,
                    date: new Date(posting.in_process_at),
                    remark: posting.posting_number,
                    invoiceLines: posting.products.map((product) => ({
                        goodCode: product.offer_id,
                        quantity: product.quantity,
                        price: product.price,
                    })),
                });
            }
        }
    }
}
