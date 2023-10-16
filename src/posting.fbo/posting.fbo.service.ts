import { Inject, Injectable } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { ProductService } from '../product/product.service';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FirebirdTransaction } from 'ts-firebird';

@Injectable()
export class PostingFboService implements IOrderable {
    constructor(
        private productService: ProductService,
        private configService: ConfigService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
    ) {}
    async createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.configService.get<number>('OZON_BUYER_ID', 24416);
        for (const product of posting.products) {
            await this.invoiceService.unPickupOzonFbo(product, posting.analytics_data.warehouse_name, transaction);
        }
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }

    async list(status: string): Promise<PostingDto[]> {
        const orders = await this.productService.orderFboList({
            limit: 1000,
            filter: {
                since: DateTime.now().minus({ day: 2 }).startOf('day').toJSDate(),
                to: DateTime.now().endOf('day').toJSDate(),
                status,
            },
            with: {
                analytics_data: true,
            },
        });
        return orders.result;
    }
    async listAwaitingDelivering(): Promise<PostingDto[]> {
        return this.list('awaiting_deliver');
    }
    listAwaitingPackaging(): Promise<PostingDto[]> {
        return this.list('awaiting_packaging');
    }
}
