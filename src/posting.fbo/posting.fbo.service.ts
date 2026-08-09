import { Inject, Injectable } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FirebirdTransaction } from 'ts-firebird';
import { EventEmitter2 } from '@nestjs/event-emitter';
// import { Cron } from '@nestjs/schedule';
import { isMarkCodesEnabled } from '../helpers';
import { OZON_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { GoodServiceEnum } from '../good/good.service.enum';
import { FboInvoiceCreatorService } from './fbo-invoice-creator.service';

@Injectable()
export class PostingFboService implements IOrderable {
    constructor(
        private productService: ProductService,
        private configService: ConfigService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private eventEmitter: EventEmitter2,
        private fboInvoiceCreator: FboInvoiceCreatorService,
    ) {}

    isFbo(): boolean {
        return true;
    }

    async createInvoice(
        posting: PostingDto,
        transaction: FirebirdTransaction,
        flushers?: (() => Promise<void>)[],
    ): Promise<InvoiceDto | null> {
        const warehouseName = posting.analytics_data?.warehouse_name;
        const clusterFrom = posting.financial_data?.cluster_from;
        const suffix = OZON_ORDER_CANCELLATION_SUFFIX.FBO.trim();
        const prims = [warehouseName, clusterFrom, suffix].filter((p): p is string => Boolean(p));

        return this.fboInvoiceCreator.create({
            service: GoodServiceEnum.OZON,
            posting,
            prims,
            primLabel: clusterFrom || warehouseName,
            buyerId: this.getBuyerId(),
            useMigration: isMarkCodesEnabled(this.configService),
            setIgkNot1c: true,
            pickupAfterCreate: false,
            skipIfNoPodbor: false,
            transaction,
            flushers,
        });
    }

    async list(status: string, day = 2): Promise<PostingDto[]> {
        const filter = {
            since: DateTime.now().minus({ day }).startOf('day').toJSDate(),
            to: DateTime.now().endOf('day').toJSDate(),
            statuses: [status],
        };
        const limit = 100; // предел v3 — 100, в v2 было 1000
        const all: PostingDto[] = [];
        let cursor = '';
        let hasMore = true;
        // Пагинации здесь не было вовсе: с limit 1000 хватало одного запроса, но новый
        // предел 100 молча обрезал бы выборку (у магазина отмен за 90 дней больше 1000).
        while (hasMore) {
            const orders = await this.productService.orderFboList({
                limit,
                cursor,
                filter,
                with: {
                    analytics_data: true,
                    financial_data: true,
                },
            });
            const postings = orders?.postings || [];
            all.push(...postings.map((order) => ({ ...order, isFbo: true })));

            // Тот же курсор в ответе = страница не сдвинулась, выходим, иначе вечный цикл.
            const nextCursor = orders?.cursor || '';
            hasMore = Boolean(orders?.has_next) && nextCursor !== '' && nextCursor !== cursor;
            cursor = nextCursor;
        }

        return all;
    }
    async listCanceled(): Promise<PostingDto[]> {
        return this.list('cancelled', 90);
    }
    async listAwaitingDelivering(): Promise<PostingDto[]> {
        return this.list('awaiting_deliver');
    }
    async listAwaitingPackaging(): Promise<PostingDto[]> {
        return this.list('awaiting_packaging');
    }

    // deprecated remove method and checkCanceledFboOrders
    // @Cron('0 */5 * * * *', { name: 'checkCanceledFboOrders' })
    async checkCanceledOrders(): Promise<void> {
        const orders = await this.listCanceled();
        const cancelled = [];
        const transaction = await this.invoiceService.getTransaction();
        try {
            for (const order of orders) {
                if (await this.invoiceService.isExists(order.posting_number, transaction)) {
                    const invoice = await this.invoiceService.getByPosting(order, transaction);
                    await this.invoiceService.pickupInvoice(invoice, transaction);
                    await this.invoiceService.updatePrim(
                        order.posting_number,
                        order.posting_number + OZON_ORDER_CANCELLATION_SUFFIX.FBO,
                        transaction,
                    );
                    cancelled.push({ prim: order.posting_number, offer_id: order.products[0].offer_id });
                }
            }
            if (cancelled.length > 0) {
                this.eventEmitter.emit('wb.order.content', 'Отменены Ozon FBO заказы', cancelled);
            }
            await transaction.commit(true);
        } catch (e) {
            await transaction.rollback(true);
            console.error(e);
        }
    }

    async getByPostingNumber(postingNumber: string): Promise<PostingDto> {
        return Promise.resolve(undefined);
    }

    getBuyerId(): number {
        return this.configService.get<number>('OZON_BUYER_ID', 24416);
    }
}
