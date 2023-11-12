import { Inject, Injectable } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbOrderDto } from './dto/wb.order.dto';
import { WbOrderStatusDto } from './dto/wb.order.status.dto';
import { chunk, find } from 'lodash';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FirebirdTransaction } from 'ts-firebird';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { ResultDto } from '../helpers/result.dto';
import { min } from 'lodash';
import { WbTransactionDto } from './dto/wb.transaction.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
@Injectable()
export class WbOrderService implements IOrderable {
    constructor(
        private api: WbApiService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
    ) {}

    async list(dateFrom = 0, initialNext = 0, limit = 1000): Promise<WbOrderDto[]> {
        const { orders, next } = await this.api.method('/api/v3/orders', 'get', { next: initialNext, limit, dateFrom });
        if (next) {
            orders.push(...(await this.list(dateFrom, next, limit)));
        }
        return orders;
    }

    async listSomeDayAgo(days = 2): Promise<WbOrderDto[]> {
        const dateFrom = DateTime.now().minus({ days }).toUnixInteger();
        return this.list(dateFrom);
    }

    async orderStatuses(orders: number[]): Promise<WbOrderStatusDto[]> {
        const res = await this.api.method('/api/v3/orders/status', 'post', { orders });
        return res.orders;
    }

    async listByStatus(orders: WbOrderDto[], status: string): Promise<WbOrderDto[]> {
        const statuses: WbOrderStatusDto[] = (
            await Promise.all(
                chunk(orders, 1000).map((chunkOrders: WbOrderDto[]) =>
                    this.orderStatuses(chunkOrders.map((order) => order.id)),
                ),
            )
        ).flat();
        return orders.filter((order) => {
            return !!find(statuses, { id: order.id, supplierStatus: status });
        });
    }

    createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.configService.get<number>('WB_BUYER_ID', 24532);
        this.eventEmitter.emit('wb.order.created', posting);
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }

    async listAwaitingDelivering(): Promise<PostingDto[]> {
        const orders = await this.listSomeDayAgo();
        return (await this.listByStatus(orders, 'complete')).map(
            (order): PostingDto => ({
                posting_number: order.id.toString(),
                status: 'complete',
                in_process_at: order.createdAt,
                products: [
                    {
                        price: (order.convertedPrice / 100).toString(),
                        offer_id: order.article,
                        quantity: 1,
                    },
                ],
            }),
        );
    }

    async listAwaitingPackaging(): Promise<PostingDto[]> {
        const orders = await this.listSomeDayAgo();
        return (await this.listByStatus(orders, 'new')).map(
            (order): PostingDto => ({
                posting_number: order.id.toString(),
                status: 'new',
                in_process_at: order.createdAt,
                products: [
                    {
                        price: (order.convertedPrice / 100).toString(),
                        offer_id: order.article,
                        quantity: 1,
                    },
                ],
            }),
        );
    }

    async getTransactions(data: TransactionFilterDto, rrdid = 0): Promise<Array<WbTransactionDto>> {
        const transactions: WbTransactionDto[] = await this.api.method(
            '/api/v1/supplier/reportDetailByPeriod',
            'statistics',
            {
                dateFrom: data.date.from,
                dateTo: data.date.to,
                rrdid,
            },
        );
        return transactions;
        // if (!transactions) return [];
        // return transactions.concat(await this.getTransactions(data, last(transactions).rrd_id));
    }
    async updateTransactions(data: TransactionFilterDto): Promise<ResultDto> {
        const transactions = await this.getTransactions(data);
        const dateFrom = min(
            transactions
                .map((t) => t.order_dt)
                .filter((date) => !!date)
                .map((date) => DateTime.fromISO(date).toUnixInteger()),
        );
        const orders = await this.list(dateFrom);
        const sridToNumber = new Map(orders.map((order) => [order.rid, order.id.toString()]));
        const commissions = new Map<string, number>();
        transactions.forEach((t) => {
            const number = sridToNumber.get(t.srid);
            if (!number) throw Error(t.srid);
            let amount = commissions.get(number);
            if (!amount) {
                amount = 0;
            }
            const ppvzForPay = t.ppvz_for_pay ?? 0;
            const deliveryRub = t.delivery_rub ?? 0;
            amount += ppvzForPay - deliveryRub;
            commissions.set(number, amount);
        });
        for (const key of commissions.keys()) {
            if (commissions.get(key) === 0) {
                commissions.delete(key);
            }
        }
        return this.invoiceService.updateByCommissions(commissions, null);
    }
}
