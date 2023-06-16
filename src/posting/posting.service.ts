import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PostingsRequestDto } from './dto/postings.request.dto';
import { PostingDto } from './dto/posting.dto';
import { DateTime } from 'luxon';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PostingService {
    private logger = new Logger(PostingService.name);
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
        this.logger.log(`Create order ${posting.posting_number} with ${posting.products.length} lines`);
        const buyerId = this.configService.get<number>('BUYER_ID', 24416);
        return this.invoiceService.create({
            buyerId,
            date: new Date(posting.in_process_at),
            remark: posting.posting_number.toString(),
            invoiceLines: posting.products.map((product) => ({
                goodCode: goodCode(product),
                quantity: product.quantity * goodQuantityCoeff(product),
                price: (parseFloat(product.price) / goodQuantityCoeff(product)).toString(),
            })),
        });
    }
}
