import { Inject, Injectable } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { Cron } from '@nestjs/schedule';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';

@Injectable()
export class OrderService {
    constructor(private productService: ProductService, @Inject(INVOICE_SERVICE) private invoiceService: IInvoice) {}
    @Cron('0 * * * * *', { name: 'updateTransactions' })
    async updateTransactions(): Promise<any> {
        const res = await this.productService.getTransactionList({
            date: {
                from: new Date('2023-06-16'),
                to: new Date('2023-06-16'),
            },
            transaction_type: 'orders',
        });
        return this.invoiceService.updateByTransactions(res);
    }
}
