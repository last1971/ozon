import { Inject, Injectable } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ResultDto } from '../helpers/result.dto';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { Cron } from '@nestjs/schedule';
import { PostingService } from '../posting/posting.service';

@Injectable()
export class OrderService {
    constructor(
        private productService: ProductService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private postingService: PostingService,
    ) {}
    async updateTransactions(data: TransactionFilterDto): Promise<ResultDto> {
        /*
        {
            date: {
                from: new Date('2023-06-16'),
                to: new Date('2023-06-16'),
            },
            transaction_type: 'orders',
        }
         */
        const res = await this.productService.getTransactionList(data);
        return this.invoiceService.updateByTransactions(res);
    }

    @Cron('0 */5 * * * *', { name: 'checkNewOrders' })
    async checkNewOrders(): Promise<void> {
        const packagingPostings = await this.postingService.listAwaitingPackaging();
        for (const posting of packagingPostings) {
            if (!(await this.invoiceService.isExists(posting.posting_number))) {
                await this.postingService.createInvoice(posting);
            }
        }
        const deliveringPostings = await this.postingService.listAwaitingDelivering();
        for (const posting of deliveringPostings) {
            let invoice = await this.invoiceService.getByPosting(posting);
            if (!invoice) {
                invoice = await this.postingService.createInvoice(posting);
            }
            await this.invoiceService.pickupInvoice(invoice);
        }
    }
}
