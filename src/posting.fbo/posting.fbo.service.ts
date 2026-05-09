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
import { goodCode, goodQuantityCoeff } from '../helpers';
import { OZON_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';

@Injectable()
export class PostingFboService implements IOrderable {
    constructor(
        private productService: ProductService,
        private configService: ConfigService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private eventEmitter: EventEmitter2,
    ) {}

    isFbo(): boolean {
        return true;
    }

    async createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        if (this.configService.get<boolean>('OZON_FBO_MARK_MIGRATION', false)) {
            return this.createInvoiceWithMarkMigration(posting, transaction);
        }
        return this.createInvoiceLegacy(posting, transaction);
    }

    private async createInvoiceLegacy(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.getBuyerId();
        const warehouseName = posting.analytics_data?.warehouse_name;
        const clusterFrom = posting.financial_data?.cluster_from;
        for (const product of posting.products) {
            let res = await this.invoiceService.unPickupOzonFbo(product, warehouseName, transaction);
            if (!res && clusterFrom) {
                res = await this.invoiceService.unPickupOzonFbo(product, clusterFrom, transaction);
            }
            if (!res) {
                res = await this.invoiceService.unPickupOzonFbo(product, OZON_ORDER_CANCELLATION_SUFFIX.FBO.trim(), transaction);
                if (res)
                    this.eventEmitter.emit('error.message', 'FBO cancels clean', warehouseName);
            }
            if (!res) {
                const id = goodCode(product);
                const quantity = product.quantity * goodQuantityCoeff(product);
                await this.invoiceService.deltaGood(id, quantity, clusterFrom || warehouseName, transaction);
            }
        }
        const invoice = await this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
        await this.invoiceService.update(invoice, { IGK: 'NOT1C' }, transaction);
        return invoice;
    }

    private async createInvoiceWithMarkMigration(
        posting: PostingDto,
        transaction: FirebirdTransaction,
    ): Promise<InvoiceDto> {
        const buyerId = this.getBuyerId();
        const warehouseName = posting.analytics_data?.warehouse_name;
        const clusterFrom = posting.financial_data?.cluster_from;
        const suffix = OZON_ORDER_CANCELLATION_SUFFIX.FBO.trim();
        const prims = [warehouseName, clusterFrom, suffix].filter((p): p is string => Boolean(p));
        const ss = this.invoiceService.getStorageSS();

        const invoice = await this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
        const newRpcs = await this.invoiceService.findRealpriceCodes(invoice.id, transaction);

        for (let i = 0; i < posting.products.length; i++) {
            const product = posting.products[i];
            const gc = goodCode(product);
            let need = product.quantity * goodQuantityCoeff(product);
            const newRpc = newRpcs[i];
            const candidates = await this.invoiceService.findFboPodbposCandidates(gc, prims, transaction);
            let suffixHit = false;

            for (const cand of candidates) {
                if (need === 0) break;
                const take = Math.min(cand.quanAvail, need);
                const codes = await this.invoiceService.getAttachedMarkCodesForMigration(
                    cand.realpricecode,
                    gc,
                    take,
                    transaction,
                );
                for (const { ki } of codes) {
                    await this.invoiceService.detachMarkCode(ki, cand.realpricecode, ss, transaction);
                }
                await this.invoiceService.decrementPodbpos(cand.podbposcode, take, transaction);
                for (const { ki } of codes) {
                    await this.invoiceService.reattachMarkCodeTransferred(ki, newRpc, gc, ss, transaction);
                }
                if (cand.prim && cand.prim.includes(suffix)) suffixHit = true;
                need -= take;
            }

            if (suffixHit) {
                this.eventEmitter.emit('error.message', 'FBO cancels clean', warehouseName);
            }
            if (need > 0) {
                await this.invoiceService.deltaGood(gc, need, clusterFrom || warehouseName, transaction);
            }
        }

        await this.invoiceService.update(invoice, { IGK: 'NOT1C' }, transaction);
        return invoice;
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
                financial_data: true,
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
