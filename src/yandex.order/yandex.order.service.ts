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
    async createInvoice(posting: PostingDto): Promise<InvoiceDto> {
        const buyerId = this.configService.get<number>('YANDEX_BUYER_ID', 24465);
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting);
    }
}
