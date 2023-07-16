import { Inject, Injectable } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PostingsRequestDto } from './dto/postings.request.dto';
import { PostingDto } from './dto/posting.dto';
import { DateTime } from 'luxon';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { IOrderable } from '../interfaces/IOrderable';

@Injectable()
export class PostingService implements IOrderable {
    constructor(
        private productService: ProductService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
    ) {}

    async list(filter: PostingsRequestDto): Promise<PostingDto[]> {
        const response = await this.productService.orderList(filter);
        return response.result?.postings || [];
    }
    async listAwaitingPackaging(): Promise<PostingDto[]> {
        return this.list({
            since: DateTime.now().minus({ day: 2 }).startOf('day').toJSDate(),
            to: DateTime.now().endOf('day').toJSDate(),
            status: 'awaiting_packaging',
        });
    }
    async listAwaitingDelivering(): Promise<PostingDto[]> {
        return this.list({
            since: DateTime.now().minus({ day: 2 }).startOf('day').toJSDate(),
            to: DateTime.now().endOf('day').toJSDate(),
            status: 'awaiting_deliver',
        });
    }
    async createInvoice(posting: PostingDto): Promise<InvoiceDto> {
        const buyerId = this.configService.get<number>('OZON_BUYER_ID', 24416);
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting);
    }
}
