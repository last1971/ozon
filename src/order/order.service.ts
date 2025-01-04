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
import { FirebirdTransaction } from "ts-firebird";
import { PostingDto } from "../posting/dto/posting.dto";
import { find } from 'lodash';

@Injectable()
export class OrderService {
    private logger = new Logger(OrderService.name);
    private orderServices: IOrderable[] = [];
    private serviceNames: any = {
        [GoodServiceEnum.OZON]: 'PostingService',
        [GoodServiceEnum.YANDEX]: 'YandexOrderService',
        [GoodServiceEnum.WB]: 'WbOrderService',
    };

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

    getServiceByName(name: GoodServiceEnum): IOrderable | null {
        return find(this.orderServices, (service) => service.constructor.name === this.serviceNames[name]) || null;
    }

    getServiceByBuyerId(buyerId: number, isFbs = true): IOrderable | null {
        return find(
            this.orderServices,
            (service: IOrderable) => service.getBuyerId() === buyerId && service.isFbo() !== isFbs,
        );
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
                await this.cancelOrders(service, transaction);
                await this.packageOrders(service, transaction);
                await this.deliveryOrders(service, transaction);
                await transaction.commit(true);
            } catch (e) {
                await transaction.rollback(true);
                this.logger.error(e.message + ' IN ' + service.constructor.name);
            }
        }
    }

    async deliveryOrders(service: IOrderable, transaction: FirebirdTransaction): Promise<void> {
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
    }

    async packageOrders(service: IOrderable, transaction: FirebirdTransaction): Promise<void> {
        const packagingPostings = await service.listAwaitingPackaging();
        for (const posting of packagingPostings) {
            if (!(await this.invoiceService.isExists(posting.posting_number, transaction))) {
                await service.createInvoice(posting, transaction);
            }
        }
    }

    async cancelOrders(service: IOrderable, transaction: FirebirdTransaction): Promise<void> {
        const orders = await service.listCanceled();
        for (const order of orders) {
            if (await this.invoiceService.isExists(order.posting_number, transaction)) {
                await this.cancelOrder(order, transaction);
            }
        }
    }

    async cancelOrder(order: PostingDto, transaction: FirebirdTransaction): Promise<void> {
        const invoice = await this.invoiceService.getByPosting(order, transaction);
        if (order.isFbo) {
            await this.invoiceService.pickupInvoice(invoice, transaction);
            await this.invoiceService.updatePrim(
                order.posting_number,
                order.posting_number + ' отмена FBO',
                transaction,
            );
        } else {
            if (invoice.status === 3) {
                await this.invoiceService.updatePrim(
                    order.posting_number,
                    order.posting_number + ' отмена',
                    transaction,
                );
                await this.invoiceService.bulkSetStatus([invoice], 0, transaction);
            }
        }
    }

    async getByPostingNumber(postingNumber: string, buyerId: number): Promise<PostingDto | null> {
        return this.getServiceByBuyerId(buyerId)?.getByPostingNumber(postingNumber);
    }

    async getByFboNumber(fboNumber: string): Promise<PostingDto | null> {
        const invoice = await this.invoiceService.getByPosting(fboNumber, null, true);
        if (!invoice) return null;
        const invoiceLines = await this.invoiceService.getInvoiceLines(invoice, null);
        return {
            posting_number: fboNumber,
            status: invoice.status.toString(),
            in_process_at: invoice.date.toString(),
            isFbo: true,
            products: invoiceLines.map((line) => ({
                price: line.price,
                offer_id: `${line.goodCode}${line.whereOrdered ? `-${line.whereOrdered}` : ''}`,
                quantity: line.quantity,
            })),
        }
    }
}
