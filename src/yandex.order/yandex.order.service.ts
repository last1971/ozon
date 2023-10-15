import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { ResultDto } from '../helpers/result.dto';
import { StatsOrderRequestDto } from './dto/stats.order.request.dto';
import { OrderStatsDto } from './dto/order.stats.dto';
import { FirebirdTransaction } from 'ts-firebird';

export enum YandexOrderSubStatus {
    STARTED = 'STARTED',
    READY_TO_SHIP = 'READY_TO_SHIP',
}
@Injectable()
export class YandexOrderService implements IOrderable, OnModuleInit {
    private campaignId: number;
    constructor(
        private yandexApi: YandexApiService,
        private vaultService: VaultService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
    ) {}
    async onModuleInit(): Promise<void> {
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = yandex['electronica-company'] as number;
    }
    async list(subStatus: YandexOrderSubStatus): Promise<PostingDto[]> {
        const res = await this.yandexApi.method(`campaigns/${this.campaignId}/orders`, 'get', {
            status: 'PROCESSING',
            substatus: subStatus,
        });
        return (res.orders || []).map(
            (order): PostingDto => ({
                posting_number: order.id,
                status: order.substatus,
                in_process_at: DateTime.fromFormat(order.creationDate, 'dd-LL-y HH:mm:ss').toJSDate().toString(),
                products: order.items.map(
                    (item): ProductPostingDto => ({
                        price: item.priceBeforeDiscount,
                        offer_id: item.offerId,
                        quantity: item.count,
                    }),
                ),
            }),
        );
    }
    async listAwaitingPackaging(): Promise<PostingDto[]> {
        return this.list(YandexOrderSubStatus.STARTED);
    }
    async listAwaitingDelivering(): Promise<PostingDto[]> {
        return this.list(YandexOrderSubStatus.READY_TO_SHIP);
    }
    async createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.configService.get<number>('YANDEX_BUYER_ID', 24465);
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }
    async statsOrder(request: StatsOrderRequestDto, page_token: string = ''): Promise<OrderStatsDto[]> {
        const res = await this.yandexApi.method(
            `campaigns/${this.campaignId}/stats/orders?page_token=${page_token}`,
            'post',
            request,
        );
        let orders: OrderStatsDto[] = [];
        if (res.result.orders.length > 0) {
            orders = (res.result.orders as OrderStatsDto[]).concat(
                await this.statsOrder(request, res.result.paging.nextPageToken),
            );
        }
        return orders;
    }
    async updateTransactions(): Promise<ResultDto> {
        const buyerId = this.configService.get<number>('YANDEX_BUYER_ID', 24465);
        const invoices = await this.invoiceService.getByBuyerAndStatus(buyerId, 4, null);
        const orders = await this.statsOrder({
            statuses: ['DELIVERED'],
            orders: invoices.map((invoice) => parseInt(invoice.remark)),
        });
        const commissions: Map<string, number> = new Map<string, number>();
        orders.forEach((order) => {
            commissions.set(
                order.partnerOrderId,
                order.payments.reduce((accumulator, payment) => accumulator + payment.total, 0) -
                    order.commissions.reduce((accumulator, commission) => accumulator + commission.actual, 0),
            );
        });
        return this.invoiceService.updateByCommissions(commissions, null);
    }
}
