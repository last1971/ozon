import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ResultDto } from '../helpers/result.dto';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { Cron } from '@nestjs/schedule';
import { PostingService } from '../posting/posting.service';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';

@Injectable()
export class OrderService {
    private logger = new Logger(OrderService.name);
    private orderServices: IOrderable[] = [];
    constructor(
        private productService: ProductService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private postingService: PostingService,
        private yandexOrder: YandexOrderService,
        private postingFboService: PostingFboService,
        private wbOrder: WbOrderService,
        private configService: ConfigService,
    ) {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.OZON)) {
            this.orderServices.push(postingFboService);
            this.orderServices.push(postingService);
        }
        if (services.includes(GoodServiceEnum.YANDEX)) this.orderServices.push(yandexOrder);
        if (services.includes(GoodServiceEnum.WB)) this.orderServices.push(wbOrder);
    }
    async updateTransactions(data: TransactionFilterDto): Promise<ResultDto> {
        /*
        {
            date: {
                from: new Date('2023-06-16'),
                to: new Date('2023-06-16'),
            },
            transaction_type: 'orders',
        }
         */
        const res = await this.productService.getTransactionList(data);
        return this.invoiceService.updateByTransactions(res, null);
    }

    @Cron('0 */5 * * * *', { name: 'checkNewOrders' })
    async checkNewOrders(): Promise<void> {
        for (const service of this.orderServices) {
            const transaction = await this.invoiceService.getTransaction();
            try {
                const packagingPostings = await service.listAwaitingPackaging();
                for (const posting of packagingPostings) {
                    if (!(await this.invoiceService.isExists(posting.posting_number, transaction))) {
                        await service.createInvoice(posting, transaction);
                    }
                }
                const deliveringPostings = await service.listAwaitingDelivering();
                for (const posting of deliveringPostings) {
                    let invoice = await this.invoiceService.getByPosting(posting, transaction);
                    if (!invoice) {
                        invoice = await service.createInvoice(posting, transaction);
                    }
                    if (invoice) {
                        await this.invoiceService.pickupInvoice(invoice, transaction);
                    }
                }
                await transaction.commit(true);
            } catch (e) {
                await transaction.rollback(true);
                this.logger.error(e.message + ' IN ' + service.constructor.name);
            }
        }
    }
}
