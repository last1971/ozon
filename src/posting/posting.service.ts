import { Inject, Injectable } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { PostingsRequestDto } from './dto/postings.request.dto';
import { PostingDto } from './dto/posting.dto';
import { DateTime } from 'luxon';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { IOrderable } from '../interfaces/IOrderable';
import { FirebirdTransaction } from 'ts-firebird';
// import { Cron } from '@nestjs/schedule';
import { ISuppliable } from '../interfaces/i.suppliable';
import * as console from 'node:console';
import { SupplyDto } from '../supply/dto/supply.dto';
import { GoodServiceEnum } from '../good/good.service.enum';
import { SupplyPositionDto } from 'src/supply/dto/supply.position.dto';
import { OzonApiService } from "../ozon.api/ozon.api.service";

@Injectable()
export class PostingService implements IOrderable, ISuppliable {
    constructor(
        private productService: ProductService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private ozonApiService: OzonApiService,
    ) {}

    isFbo(): boolean {
        return false;
    }

    getSupplyPositions(id: string): Promise<SupplyPositionDto[]> {
        throw new Error('Method not implemented.');
    }

    async list(status: string, day = 3): Promise<PostingDto[]> {
        const filter: PostingsRequestDto = {
            since: DateTime.now().minus({ day }).startOf('day').toJSDate(),
            to: DateTime.now().endOf('day').toJSDate(),
            status,
        };
        const limit = 100; // Размер страницы
        let offset = 0;
        let allPostings: PostingDto[] = [];
        let hasMore = true;
        while (hasMore) {
            const response = await this.productService.orderList(filter, limit, offset);
            const postings = response.result?.postings || [];

            allPostings = allPostings.concat(postings);

            // Продолжаем, если было извлечено ровно `limit` записей
            hasMore = postings.length === limit;
            offset += limit;
        }

        return allPostings;
    }
    async listAwaitingPackaging(): Promise<PostingDto[]> {
        return this.list('awaiting_packaging', 5);
    }
    async listAwaitingDelivering(): Promise<PostingDto[]> {
        return this.list('awaiting_deliver');
    }
    async listCanceled(): Promise<PostingDto[]> {
        return this.list('cancelled', 7);
    }
    // deprecated remove method and checkCanceledOzonOrders
    // @Cron('0 */5 * * * *', { name: 'checkCanceledOzonOrders' })
    async checkCancelled(): Promise<void> {
        const orders = await this.listCanceled();
        const transaction = await this.invoiceService.getTransaction();
        try {
            for (const order of orders) {
                if (await this.invoiceService.isExists(order.posting_number, transaction)) {
                    const invoice = await this.invoiceService.getByPosting(order, transaction);
                    if (invoice.status === 3) {
                        await this.invoiceService.updatePrim(
                            order.posting_number,
                            order.posting_number + ' отмена',
                            transaction,
                        );
                        await this.invoiceService.bulkSetStatus([invoice], 0, transaction);
                    }
                }
            }
            await transaction.commit(true);
        } catch (e) {
            await transaction.rollback(true);
            console.error(e);
        }
    }
    async createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.getBuyerId();
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }

    async getSupplies(): Promise<SupplyDto[]> {
        return [
            {
                id: 'ozon-fbs',
                remark: 'Ozon-FBS',
                goodService: GoodServiceEnum.OZON,
                isMarketplace: true,
            },
        ];
    }

    async getByPostingNumber(postingNumber: string): Promise<PostingDto> {
        const res = await this.ozonApiService.method('/v3/posting/fbs/get', { posting_number: postingNumber });
        return res.result;
    }

    getBuyerId(): number {
        return this.configService.get<number>('OZON_BUYER_ID', 24416);
    }
}
