import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
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
import { FbsPrepareDto, IMarkSubmittable, SubmitFailureDto, SubmitResultDto } from '../interfaces/IMarkSubmittable';
import { ExemplarCreateOrGetResponseDto } from './dto/exemplar.create-or-get.dto';
import { ExemplarSetProductDto, ExemplarSetRequestDto, ExemplarSetResponseDto } from './dto/exemplar.set.dto';
import { ExemplarValidateResponseDto } from './dto/exemplar.validate.dto';
import { ExemplarStatusResponseDto } from './dto/exemplar.status.dto';
import { ShipPostingRequestDto, ShipPostingResponseDto } from './dto/ship.posting.dto';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { IFbsSubmitContext } from './interfaces/fbs-submit.context';
import { CreateOrGetExemplarsCommand } from './commands/create-or-get-exemplars.command';
import { BuildExemplarsPayloadCommand } from './commands/build-exemplars-payload.command';
import { ValidateExemplarsCommand } from './commands/validate-exemplars.command';
import { SetAndConfirmExemplarsCommand } from './commands/set-and-confirm-exemplars.command';
import { ShipExemplarsCommand } from './commands/ship-exemplars.command';
import { firstPageOnly } from '../helpers/pdf/pdf.helpers';

@Injectable()
export class PostingService implements IOrderable, ISuppliable, IMarkSubmittable {
    private readonly logger = new Logger(PostingService.name);
    constructor(
        private productService: ProductService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private ozonApiService: OzonApiService,
        private createOrGetExemplarsCommand: CreateOrGetExemplarsCommand,
        private buildExemplarsPayloadCommand: BuildExemplarsPayloadCommand,
        private validateExemplarsCommand: ValidateExemplarsCommand,
        private setAndConfirmExemplarsCommand: SetAndConfirmExemplarsCommand,
        private shipExemplarsCommand: ShipExemplarsCommand,
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
            statuses: [status],
        };
        const limit = 100; // Предел v4 — 100, в v3 было 1000
        let allPostings: PostingDto[] = [];
        let cursor = '';
        let hasMore = true;
        while (hasMore) {
            const response = await this.productService.orderList(filter, limit, cursor);
            const postings = response?.postings || [];

            allPostings = allPostings.concat(postings);

            // Курсор вместо offset: offset в v4 сломан — отдаёт первую страницу по кругу.
            // Тот же курсор в ответе = страница не сдвинулась, выходим, иначе вечный цикл.
            const nextCursor = response?.cursor || '';
            hasMore = Boolean(response?.has_next) && nextCursor !== '' && nextCursor !== cursor;
            cursor = nextCursor;
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

    /** Сухая проверка марок+ГТД перед set (ничего не сохраняет). */
    async validateExemplars(
        postingNumber: string,
        products: ExemplarSetProductDto[],
    ): Promise<ExemplarValidateResponseDto> {
        return this.ozonApiService.method('/v5/fbs/posting/product/exemplar/validate', {
            posting_number: postingNumber,
            products,
        });
    }

    async getExemplarStatus(postingNumber: string): Promise<ExemplarStatusResponseDto> {
        return this.ozonApiService.method('/v5/fbs/posting/product/exemplar/status', {
            posting_number: postingNumber,
        });
    }

    async shipPosting(req: ShipPostingRequestDto): Promise<ShipPostingResponseDto> {
        return this.ozonApiService.method('/v4/posting/fbs/ship', req);
    }

    // Ждём ПЕРЕД каждой попыткой package-label по 15 c → попытки на 15/30/45/60 c (Озон формирует этикетку не сразу).
    private readonly labelRetryDelaysMs = [15000, 15000, 15000, 15000];

    /** Этикетка отправления, стр.1 (ШК). Товарный ярлык (стр.2) Озон подкладывает всегда — режем. */
    async getShipmentLabel(invoice: InvoiceDto): Promise<Buffer> {
        // После ship этикетка готовится не мгновенно — Озон отдаёт 400, пока не сгенерирована. Ретраим.
        const delaysMs = this.labelRetryDelaysMs;
        let lastErr: any;
        for (let i = 0; i < delaysMs.length; i++) {
            if (delaysMs[i]) await new Promise((r) => setTimeout(r, delaysMs[i]));
            try {
                const pdf = await this.ozonApiService.methodBinary('/v2/posting/fbs/package-label', {
                    posting_number: [invoice.remark],
                });
                return firstPageOnly(pdf);
            } catch (e) {
                lastErr = e;
            }
        }
        throw new BadRequestException(
            `Этикетка ещё не готова, повторите через несколько секунд: ${lastErr?.message ?? 'package-label недоступен'}`,
        );
    }

    /** ШК отправления (upper_barcode) — эталон для сверки IGK==ШК. */
    async getShipmentBarcode(invoice: InvoiceDto): Promise<string> {
        const res = await this.ozonApiService.method('/v3/posting/fbs/get', {
            posting_number: invoice.remark,
        });
        return res?.result?.barcodes?.upper_barcode ?? '';
    }

    async getPostingProductMap(postingNumber: string): Promise<Map<string, number>> {
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

    /** Фаза 1: create-or-get → флаги марка/ГТД по строкам (для скан-гейта и диалога на фронте). */
    async prepareFbsMarks(invoice: InvoiceDto): Promise<FbsPrepareDto> {
        const exResp = await this.createOrGetExemplars(invoice.remark);
        if (!exResp || !exResp.products) {
            return { ok: false, error: 'createOrGet вернул пустой ответ' };
        }
        return {
            ok: true,
            multiBoxQty: exResp.multi_box_qty || 1,
            lines: exResp.products.map((p) => ({
                productId: p.product_id,
                quantity: p.quantity,
                markNeeded: !!p.is_mandatory_mark_needed,
                gtdNeeded: p.is_gtd_needed !== false,
            })),
        };
    }

    async submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto> {
        const postingNumber = invoice.remark;
        const isDryRun =
            postingNumber?.startsWith('FBS-MIG-') &&
            this.configService.get<string>('NODE_ENV') === 'development';

        // attached пуст — НЕ выходим: немаркированный заказ тоже идёт в цепочку (ГТД из подбора + ship).
        const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, null);

        const failed: SubmitFailureDto[] = [];
        const kmFullByKi = new Map<string, string>();
        for (const a of attached) {
            const full = await this.invoiceService.getKmFullByKi(a.ki, null);
            if (!full) failed.push({ ki: a.ki, reason: 'KM_FULL пуст' });
            else kmFullByKi.set(a.ki, full);
        }
        // Маркированный заказ с привязками, но все KM_FULL пусты → ошибка данных, в Озон не идём.
        if (attached.length > 0 && kmFullByKi.size === 0) return { ok: false, failed };

        // ГТД берём из ПРИХОДА кода (PR_META → SKLADIN/SHOPIN). Нет прихода/ГТД → null.
        const gtdByKi = new Map<string, string | null>();
        for (const a of attached) {
            try {
                gtdByKi.set(a.ki, await this.invoiceService.getGtdByKi(a.ki, null));
            } catch (e) {
                this.logger.warn(`[km ${postingNumber}] GTD lookup fail ${a.ki}: ${e?.message ?? e}`);
                gtdByKi.set(a.ki, null);
            }
        }

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

        // Передача в Озон — цепочка команд (create-or-get → build payload → set+confirm).
        const ctx: IFbsSubmitContext = {
            invoice,
            postingNumber,
            attached,
            kmFullByKi,
            gtdByKi,
            failed,
        };
        const chain = new CommandChainAsync<IFbsSubmitContext>([
            this.createOrGetExemplarsCommand,
            this.buildExemplarsPayloadCommand,
            this.validateExemplarsCommand,
            this.setAndConfirmExemplarsCommand,
            this.shipExemplarsCommand,
        ]);
        const done = await chain.execute(ctx);
        return done.result ?? (failed.length === 0 ? { ok: true } : { ok: false, failed });
    }
}
