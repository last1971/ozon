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
import { Cron } from '@nestjs/schedule';
import { goodCode, goodQuantityCoeff } from '../helpers';

@Injectable()
export class PostingFboService implements IOrderable {
    constructor(
        private productService: ProductService,
        private configService: ConfigService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private eventEmitter: EventEmitter2,
    ) {}
    async createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.configService.get<number>('OZON_BUYER_ID', 24416);
        for (const product of posting.products) {
            let res = await this.invoiceService.unPickupOzonFbo(
                product,
                posting.analytics_data.warehouse_name,
                transaction,
            );
            if (!res) {
                res = await this.invoiceService.unPickupOzonFbo(product, 'отмена FBO', transaction);
                if (res)
                    this.eventEmitter.emit('error.message', 'FBO cancels clean', posting.analytics_data.warehouse_name);
            }
            if (!res) {
                const id = goodCode(product);
                const quantity = product.quantity * goodQuantityCoeff(product);
                await this.invoiceService.deltaGood(id, quantity, posting.analytics_data.warehouse_name, transaction);
            }
        }
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }

    async list(status: string, day = 2): Promise<PostingDto[]> {
        const orders = await this.productService.orderFboList({
            limit: 1000,
            filter: {
                since: DateTime.now().minus({ day }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                status,
            },
            with: {
                analytics_data: true,
            },
        });
        return orders.result.map(order => ({
            ...order,
            isFbo: true
        }));
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
                        order.posting_number + ' отмена FBO',
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
}
