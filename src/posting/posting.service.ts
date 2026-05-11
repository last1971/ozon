import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { ReturnsListDto } from './dto/returns.list.dto';
import { ReturnDto } from './dto/return.dto';
import { IMarkSubmittable, SubmitFailureDto, SubmitResultDto } from '../interfaces/IMarkSubmittable';
import {
    ExemplarCreateOrGetResponseDto,
    ExemplarItemDto,
    ExemplarProductDto,
} from './dto/exemplar.create-or-get.dto';
import {
    ExemplarSetItemDto,
    ExemplarSetProductDto,
    ExemplarSetRequestDto,
    ExemplarSetResponseDto,
} from './dto/exemplar.set.dto';
import { ExemplarStatusResponseDto } from './dto/exemplar.status.dto';
import {
    ShipPostingPackageDto,
    ShipPostingRequestDto,
    ShipPostingResponseDto,
} from './dto/ship.posting.dto';
import { pollUntil, PollDecision } from '../helpers/poll.util';

@Injectable()
export class PostingService implements IOrderable, ISuppliable, IMarkSubmittable {
    private readonly logger = new Logger(PostingService.name);
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

    async listReturns(days = 7): Promise<ReturnDto[]> {
        let allReturns: ReturnDto[] = [];
        let lastId = 0;
        let hasNext = true;

        while (hasNext) {
            const filter = {
                filter: {
                    logistic_return_date: {
                        time_from: DateTime.now().minus({ days }).startOf('day').toISO(),
                        time_to: DateTime.now().endOf('day').toISO(),
                    },
                },
                limit: 500,
                last_id: lastId,
            };

            const result: ReturnsListDto = await this.ozonApiService.method('/v1/returns/list', filter);
            const returns = result?.returns || [];

            allReturns = allReturns.concat(returns);

            hasNext = result?.has_next || false;
            if (returns.length > 0) {
                lastId = returns[returns.length - 1].id;
            }
        }

        return allReturns;
    }

    // deprecated remove method and checkCanceledOzonOrders
    // @Cron('0 */5 * * * *', { name: 'checkCanceledOzonOrders' })
    /*
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
                            order.posting_number + OZON_ORDER_CANCELLATION_SUFFIX.REGULAR,
                            transaction,
                        );
                        await this.invoiceService.bulkSetStatus([invoice], 0, transaction);
                    }
                    if (invoice.status === 4) {
                        await this.invoiceService.updatePrim(
                            order.posting_number,
                            order.posting_number + OZON_ORDER_CANCELLATION_SUFFIX.FBO,
                            transaction,
                        );
                    }
                }
            }
            await transaction.commit(true);
        } catch (e) {
            await transaction.rollback(true);
            console.error(e);
        }
    }
    */
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
        let result: PostingDto | null = null;
        try {
            const res = await this.ozonApiService.method('/v3/posting/fbs/get', { posting_number: postingNumber });
            result = res?.result ?? null;
        } catch (e) {
            if (!this.configService.get<boolean>('MARK_CODES_ENABLED', false)) throw e;
        }
        if (result) return result;
        if (!this.configService.get<boolean>('MARK_CODES_ENABLED', false)) return result;
        const invoice = await this.invoiceService.getByPosting(postingNumber, null);
        if (!invoice) return null;
        const invoiceLines = await this.invoiceService.getInvoiceLines(invoice, null);
        return {
            posting_number: postingNumber,
            status: invoice.status.toString(),
            in_process_at: invoice.date.toString(),
            products: invoiceLines.map((line) => ({
                price: line.price,
                offer_id: `${line.goodCode}${line.whereOrdered ? `-${line.whereOrdered}` : ''}`,
                quantity: line.quantity,
            })),
        };
    }

    getBuyerId(): number {
        return this.configService.get<number>('OZON_BUYER_ID', 24416);
    }

    async createOrGetExemplars(postingNumber: string): Promise<ExemplarCreateOrGetResponseDto> {
        return this.ozonApiService.method('/v6/fbs/posting/product/exemplar/create-or-get', {
            posting_number: postingNumber,
        });
    }

    async setExemplars(req: ExemplarSetRequestDto): Promise<ExemplarSetResponseDto> {
        return this.ozonApiService.method('/v6/fbs/posting/product/exemplar/set', req);
    }

    async getExemplarStatus(postingNumber: string): Promise<ExemplarStatusResponseDto> {
        return this.ozonApiService.method('/v5/fbs/posting/product/exemplar/status', {
            posting_number: postingNumber,
        });
    }

    async shipPosting(req: ShipPostingRequestDto): Promise<ShipPostingResponseDto> {
        return this.ozonApiService.method('/v4/posting/fbs/ship', req);
    }

    private async getPostingProductMap(postingNumber: string): Promise<Map<string, number>> {
        const res = await this.ozonApiService.method('/v3/posting/fbs/get', {
            posting_number: postingNumber,
        });
        const products = res?.result?.products ?? [];
        const map = new Map<string, number>();
        for (const p of products) {
            const goodscode = String(p.offer_id ?? '').split('-')[0];
            const productId = Number(p.sku);
            if (goodscode && productId) map.set(goodscode, productId);
        }
        return map;
    }

    async submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto> {
        const postingNumber = invoice.remark;
        const isDryRun =
            postingNumber?.startsWith('FBS-MIG-') &&
            this.configService.get<string>('NODE_ENV') === 'development';

        const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, null);
        if (attached.length === 0) return { ok: true };

        const failed: SubmitFailureDto[] = [];
        const kmFullByKi = new Map<string, string>();
        for (const a of attached) {
            const full = await this.invoiceService.getKmFullByKi(a.ki, null);
            if (!full) failed.push({ ki: a.ki, reason: 'KM_FULL пуст' });
            else kmFullByKi.set(a.ki, full);
        }
        if (kmFullByKi.size === 0) return { ok: false, failed };

        if (isDryRun) {
            return {
                ok: true,
                dryRun: true,
                payload: {
                    posting_number: postingNumber,
                    marks: Array.from(kmFullByKi.values()),
                    failed,
                },
            };
        }

        const exResp = await this.createOrGetExemplars(postingNumber);
        if (!exResp || !exResp.products) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: 'createOrGet вернул пустой ответ' }],
                skipRetry: true,
            };
        }

        const productMap = await this.getPostingProductMap(postingNumber);
        if (productMap.size === 0) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: 'posting/fbs/get не вернул products' }],
                skipRetry: true,
            };
        }

        const attachedByProduct = new Map<number, { ki: string; mark: string }[]>();
        for (const a of attached) {
            const mark = kmFullByKi.get(a.ki);
            if (!mark) continue;
            const productId = productMap.get(a.goodscode);
            if (!productId) {
                failed.push({ ki: a.ki, reason: `goodscode ${a.goodscode} не найден в posting` });
                continue;
            }
            if (!attachedByProduct.has(productId)) attachedByProduct.set(productId, []);
            attachedByProduct.get(productId).push({ ki: a.ki, mark });
        }

        const setProducts: ExemplarSetProductDto[] = [];
        const shipProducts: ShipPostingPackageDto['products'] = [];
        for (const exProduct of exResp.products as ExemplarProductDto[]) {
            const group = attachedByProduct.get(exProduct.product_id) ?? [];
            if (group.length === 0) continue;
            if (group.length !== exProduct.quantity) {
                failed.push({
                    ki: '*',
                    reason: `product_id ${exProduct.product_id}: КМ ${group.length}, ожидается ${exProduct.quantity}`,
                });
                continue;
            }
            const exemplars: ExemplarSetItemDto[] = exProduct.exemplars
                .slice(0, group.length)
                .map((ex: ExemplarItemDto, i: number) => ({
                    exemplar_id: ex.exemplar_id,
                    marks: [{ mark: group[i].mark, mark_type: 'mandatory_mark' as const }],
                    gtd: '',
                    is_gtd_absent: true as const,
                    is_rnpt_absent: true as const,
                }));
            setProducts.push({ product_id: exProduct.product_id, exemplars });
            shipProducts.push({
                product_id: exProduct.product_id,
                quantity: group.length,
                exemplar_ids: exemplars.map((e) => e.exemplar_id),
            });
        }

        if (setProducts.length === 0) {
            return { ok: false, failed };
        }

        const setResp = await this.setExemplars({
            posting_number: postingNumber,
            multi_box_qty: exResp.multi_box_qty || 1,
            products: setProducts,
        });
        if (!setResp?.result) {
            return {
                ok: false,
                failed: [...failed, { ki: '*', reason: 'setExemplars result=false' }],
            };
        }

        const pollRes = await pollUntil<ExemplarStatusResponseDto>(
            () => this.getExemplarStatus(postingNumber),
            (v): PollDecision => {
                if (v?.status === 'ship_available') return 'done';
                if (v?.status === 'ship_not_available') return 'fail';
                return 'continue';
            },
        );
        if (pollRes.status !== 'done') {
            return {
                ok: false,
                failed: [
                    ...failed,
                    { ki: '*', reason: `polling ${pollRes.status} (last=${pollRes.value?.status})` },
                ],
            };
        }

        await this.shipPosting({
            posting_number: postingNumber,
            packages: [{ products: shipProducts }],
        });

        return failed.length === 0 ? { ok: true } : { ok: false, failed };
    }
}
