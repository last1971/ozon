import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ResultDto } from '../helpers/dto/result.dto';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { Cron } from '@nestjs/schedule';
import { PostingService } from '../posting/posting.service';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { WbCustomerService } from '../wb.customer/wb.customer.service';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { FirebirdTransaction } from "ts-firebird";
import { PostingDto } from "../posting/dto/posting.dto";
import { find } from 'lodash';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { OZON_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
        private wbCustomer: WbCustomerService,
        private configService: ConfigService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private eventEmitter: EventEmitter2,
    ) {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.WB)) this.orderServices.push(wbOrder);
        if (services.includes(GoodServiceEnum.OZON)) {
            this.orderServices.push(postingFboService);
            this.orderServices.push(postingService);
        }
        if (services.includes(GoodServiceEnum.YANDEX)) this.orderServices.push(yandexOrder);
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
                await this.processReturns(service, transaction);
                await this.packageOrders(service, transaction);
                await this.deliveryOrders(service, transaction);
                await transaction.commit(true);
            } catch (e) {
                await transaction.rollback(true);
                this.logger.error(e.message + ' IN ' + service.constructor.name);
            }
        }
    }

    private async processWithCache<T extends { posting_number: string }>(
        cacheName: string,
        service: IOrderable,
        items: T[],
        processor: (item: T) => Promise<void>,
    ): Promise<void> {
        const serviceName = service.constructor.name;
        const cacheKey = `processed:${cacheName}:${serviceName}`;
        const cacheTtlDays = this.configService.get<number>('CACHE_TTL_DAYS', 14);

        // Redis хранит строку с разделителями, конвертируем в Set
        const cachedString = await this.cacheManager.get<string>(cacheKey) || '';
        const processedSet = new Set<string>(cachedString ? cachedString.split(',') : []);

        for (const item of items) {
            if (processedSet.has(item.posting_number)) {
                continue;
            }
            await processor(item);
            processedSet.add(item.posting_number);
        }

        // Сохраняем как строку с разделителями
        await this.cacheManager.set(cacheKey, Array.from(processedSet).join(','), cacheTtlDays * 24 * 60 * 60 * 1000);
    }

    async deliveryOrders(service: IOrderable, transaction: FirebirdTransaction): Promise<void> {
        const deliveringPostings = await service.listAwaitingDelivering();

        await this.processWithCache('delivery', service, deliveringPostings, async (posting) => {
            let invoice = await this.invoiceService.getByPosting(posting, transaction);
            if (!invoice) {
                invoice = await service.createInvoice(posting, transaction);
            }
            if (invoice) {
                await this.invoiceService.pickupInvoice(invoice, transaction);
            }
        });
    }

    async packageOrders(service: IOrderable, transaction: FirebirdTransaction): Promise<void> {
        const packagingPostings = await service.listAwaitingPackaging();

        await this.processWithCache('packaging', service, packagingPostings, async (posting) => {
            if (!(await this.invoiceService.isExists(posting.posting_number, transaction))) {
                await service.createInvoice(posting, transaction);
            }
        });
    }

    async cancelOrders(service: IOrderable, transaction: FirebirdTransaction): Promise<void> {
        const orders = await service.listCanceled();

        await this.processWithCache('cancellations', service, orders, async (order) => {
            if (await this.invoiceService.isExists(order.posting_number, transaction)) {
                await this.cancelOrder(order, transaction);
            }
        });
    }

    async processReturns(service: IOrderable, transaction: FirebirdTransaction): Promise<void> {
        if (service.constructor.name !== 'PostingService') {
            return;
        }

        const postingService = service as PostingService;
        const returns = await postingService.listReturns();

        await this.processWithCache('returns', service, returns, async (returnItem) => {
            if (await this.invoiceService.isExists(returnItem.posting_number, transaction)) {
                const invoice = await this.invoiceService.getByPosting(returnItem.posting_number, transaction);
                await this.invoiceService.update(invoice, { IGK: 'NOT1C' }, transaction);
                await this.processInvoiceStatus4(invoice, returnItem.posting_number, transaction, 'returned');
            }
        });
    }

    private async processInvoiceStatus4(
        invoice: InvoiceDto,
        postingNumber: string,
        transaction: FirebirdTransaction,
        type: 'cancelled' | 'returned',
    ): Promise<void> {
        if (invoice.status === 4) {
            await this.invoiceService.updatePrim(
                postingNumber,
                postingNumber + OZON_ORDER_CANCELLATION_SUFFIX.FBO,
                transaction,
            );
            this.logger.log(`${type === 'cancelled' ? 'FBS (pickuped) order' : 'Return'} ${postingNumber} was ${type}`);
        } else {
            this.eventEmitter.emit(
                'error.message',
                `${type === 'cancelled' ? 'Cancel' : 'Return'} wrong status`,
                `${postingNumber}: status=${invoice.status}`,
            );
        }
    }

    async cancelOrder(order: PostingDto, transaction: FirebirdTransaction): Promise<void> {
        const invoice = await this.invoiceService.getByPosting(order, transaction);
        await this.invoiceService.update(invoice, { IGK: 'NOT1C' }, transaction);
        if (order.isFbo) {
            await this.invoiceService.pickupInvoice(invoice, transaction);
            await this.invoiceService.updatePrim(
                order.posting_number,
                order.posting_number + OZON_ORDER_CANCELLATION_SUFFIX.FBO,
                transaction,
            );
            this.logger.log(`FBO order ${order.posting_number} was cancelled`);
        } else {
            if (invoice.status === 3) {
                await this.invoiceService.updatePrim(
                    order.posting_number,
                    order.posting_number + OZON_ORDER_CANCELLATION_SUFFIX.REGULAR,
                    transaction,
                );
                await this.invoiceService.bulkSetStatus([invoice], 0, transaction);
                this.logger.log(`FBS (not pickuped) order ${order.posting_number} was cancelled`);
            } else {
                await this.processInvoiceStatus4(invoice, order.posting_number, transaction, 'cancelled');
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

    /**
     * Получить накладную по ID претензии WB
     * 1. Получаем претензию по ID
     * 2. Извлекаем srid и order_dt
     * 3. Получаем накладную через getInvoiceBySrid
     * @param claimId - UUID претензии
     * @returns Накладная или null
     */
    async getInvoiceByClaimId(claimId: string): Promise<InvoiceDto | null> {
        // Получаем претензию
        const claim = await this.wbCustomer.getClaimById(claimId);

        if (!claim) {
            return null;
        }

        // Извлекаем srid и order_dt из претензии
        const { srid, order_dt } = claim;

        if (!srid || !order_dt) {
            return null;
        }

        // Получаем накладную через WbOrderService
        return this.wbOrder.getInvoiceBySrid({
            dateFrom: order_dt.substring(0, 10), // Берем только дату YYYY-MM-DD
            srid,
        });
    }
}
