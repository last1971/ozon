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

@Injectable()
export class WbOrderService implements IOrderable {
    constructor(
        private api: WbApiService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
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
}
