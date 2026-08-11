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
import { Cron } from '@nestjs/schedule';
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
import { MpEventDto, MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';

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
        private mpEvent: MpEventService,
        private mpRunner: MpDecisionRunnerService,
    ) {}

    isFbo(): boolean {
        return false;
    }

    getSupplyPositions(id: string): Promise<SupplyPositionDto[]> {
        throw new Error('Method not implemented.');
    }

    /**
     * @param day    ширина окна по дате СОЗДАНИЯ отправления (since/to, обязательны в v4)
     * @param lcsdDay окно по дате СМЕНЫ СТАТУСА, дни назад от «сейчас». Задан — выборка
     *               становится инкрементальной: 45-дневное окно создания перестаёт тянуть
     *               весь хвост, приходят только реально изменившиеся отправления.
     *               С итерации 4 начало окна поедет от `MAX(LAST_SEEN)` журнала.
     */
    async list(status: string, day = 3, lcsdDay?: number): Promise<PostingDto[]> {
        const filter: PostingsRequestDto = {
            since: DateTime.now().minus({ day }).startOf('day').toJSDate(),
            to: DateTime.now().endOf('day').toJSDate(),
            statuses: [status],
        };
        if (lcsdDay) {
            // Начало окна смены статуса даёт журнал: MAX(LAST_SEEN) по паре минус нахлёст.
            // Простой сервиса дольше нахлёста больше не съедает события молча — Ozon второй
            // раз их не покажет. Журнал пуст (холодный старт) → «сейчас минус lcsdDay».
            const from = await this.mpEvent.windowStart('OZON', 'POSTING_FBS', lcsdDay, lcsdDay);
            filter.last_changed_status_date = {
                from: DateTime.fromJSDate(from).toISO(),
                to: DateTime.now().endOf('day').toISO(),
            };
        }
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
        // РАБОЧЕЕ окно действий — трогать нельзя до итерации 8 плана: расширение подняло бы
        // накопленный хвост (~30 % отмен, которых система не видела), и его обработала бы
        // старая логика «донор немедленно при отмене». Хвост пока только наблюдаем.
        return this.list('cancelled', PostingService.ACTION_WINDOW_DAYS);
    }

    /** Окно действий (отмены). Расширение — итерация 8, не раньше. */
    private static readonly ACTION_WINDOW_DAYS = 7;
    /** Окно наблюдения по дате создания отправления: отмена приходит и через 26 дней после заказа. */
    private static readonly WIDE_WINDOW_DAYS = 45;
    /** Нахлёст по дате смены статуса. С итерации 4 отсчёт поедет от `MAX(LAST_SEEN)` журнала. */
    private static readonly LCSD_OVERLAP_DAYS = 2;
    /**
     * Промежуточные статусы опрашиваем ради правила «пришла отмена, а записи о `delivering`
     * нет → товар ещё у нас» (заработает с журналом, итерация 4).
     */
    private static readonly OBSERVED_STATUSES = ['cancelled', 'delivered', 'awaiting_deliver', 'delivering'];

    /**
     * Итерация 2 плана FBS-выбытия: наблюдение за расширенным окном.
     * НИЧЕГО не делает — только пишет в лог сервиса. Действия остаются на рабочем
     * 7-дневном окне (`listCanceled`) вплоть до итерации 8.
     */
    @Cron('0 */5 * * * *', { name: 'observeFbsWideWindow' })
    async observeWideWindow(): Promise<void> {
        if (!this.configService.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.OZON)) return;

        const actionEdge = DateTime.now().minus({ day: PostingService.ACTION_WINDOW_DAYS }).startOf('day');
        const found: { status: string; postings: PostingDto[] }[] = [];
        let apiErrors = 0;

        for (const status of PostingService.OBSERVED_STATUSES) {
            try {
                found.push({
                    status,
                    postings: await this.list(
                        status,
                        PostingService.WIDE_WINDOW_DAYS,
                        PostingService.LCSD_OVERLAP_DAYS,
                    ),
                });
            } catch (e) {
                apiErrors++;
                this.logger.warn(`наблюдение: статус ${status} — ошибка API: ${e.message}`);
            }
        }

        // Журнал: пишем всё увиденное. На нём стоит окно следующей выборки, и на нём же
        // держится правило «пришла отмена, а записи о delivering нет → товар ещё у нас».
        // Он же дедуплицирует решающую таблицу: вхолостую считаем только события,
        // которых в журнале ещё не было, то есть одно решение на одно состояние.
        for (const { status, postings } of found) {
            for (const posting of postings) {
                const event: MpEventDto = {
                    service: 'OZON',
                    kind: 'POSTING_FBS',
                    extId: posting.posting_number,
                    state: status,
                    posting: posting.posting_number,
                };
                let isNew = false;
                try {
                    isNew = await this.mpEvent.record(event);
                } catch (e) {
                    this.logger.warn(`журнал: ${posting.posting_number}/${status} не записан — ${e.message}`);
                    continue;
                }
                // Продажа исполняется (итерация 7): недоделанное delivered-событие
                // ретраится каждым проходом, пока не помечено в журнале. Остальные
                // статусы — только наблюдение по новым событиям, как в итерации 5.
                const saleLive = status === 'delivered' && this.mpRunner.salesEnabled();
                if (!isNew && !saleLive) continue;
                if (status === 'cancelled') {
                    // Схема FBS — по источнику события; отмены исполняет cancelOrder.
                    await this.mpRunner.observePosting(posting.posting_number, 'FBS', 'cancel');
                    continue;
                }
                if (status !== 'delivered') continue;
                if (!saleLive) {
                    await this.mpRunner.observePosting(posting.posting_number, 'FBS', 'delivered');
                    continue;
                }
                try {
                    if (await this.mpEvent.isHandled(event)) continue;
                    const decision = await this.mpRunner.observePosting(posting.posting_number, 'FBS', 'delivered');
                    // Потолок прогона или сбой наблюдения — событие возьмётся следующим проходом.
                    if (!decision) continue;
                    if (this.mpRunner.needsExecution(decision)) await this.mpRunner.execute(decision);
                    await this.mpEvent.markHandled(event);
                } catch (e) {
                    this.logger.warn(`продажа ${posting.posting_number}: действия не выполнены — ${e.message}`);
                }
            }
        }
        this.mpRunner.flush('observeFbsWideWindow');

        const all = found.flatMap((f) => f.postings);
        if (!all.length) {
            this.logger.log(
                `наблюдение (окно ${PostingService.WIDE_WINDOW_DAYS} дн, смена статуса за ` +
                    `${PostingService.LCSD_OVERLAP_DAYS} дн): пусто, ошибок API ${apiErrors}`,
            );
            return;
        }

        const invoices = await this.invoiceService.getByPostingNumbers(all.map((p) => p.posting_number));
        const byRemark = new Map(invoices.map((invoice) => [(invoice.remark ?? '').trim(), invoice]));
        const marks = await this.countMarksByScode(invoices);

        for (const { status, postings } of found) {
            // in_process_at приходит строкой ISO, но в тестах и старых записях бывает Date —
            // fromJSDate(new Date(...)) переваривает оба.
            const tail = postings.filter((p) => DateTime.fromJSDate(new Date(p.in_process_at as any)) < actionEdge);
            this.logger.log(
                `наблюдение ${status}: всего ${postings.length}, в рабочем окне ` +
                    `${postings.length - tail.length}, из хвоста ${tail.length}`,
            );
            for (const posting of postings) {
                const invoice = byRemark.get(posting.posting_number);
                this.logger.log(
                    `наблюдение ${status} ${posting.posting_number}: ` +
                        (invoice
                            ? `счёт ${invoice.id} статус ${invoice.status}, кодов ${marks.get(invoice.id) ?? 0}`
                            : 'счёта нет') +
                        (tail.includes(posting) ? ', из хвоста' : ''),
                );
            }
        }
        this.logger.log(`наблюдение: ошибок API ${apiErrors}`);
    }

    /** Сколько кодов привязано к каждому найденному счёту — одним чтением на весь прогон. */
    private async countMarksByScode(invoices: InvoiceDto[]): Promise<Map<number, number>> {
        const counts = new Map<number, number>();
        if (!invoices.length) return counts;
        const transaction = await this.invoiceService.getTransaction();
        try {
            for (const invoice of invoices) {
                const codes = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, transaction);
                counts.set(invoice.id, codes.length);
            }
        } catch (e) {
            this.logger.warn(`наблюдение: коды не прочитаны — ${e.message}`);
        } finally {
            await transaction.commit(true);
        }
        return counts;
    }

    /**
     * Возвраты за окно от журнала.
     *
     * Фильтр сменился с `logistic_return_date` на `visual_status_change_moment`
     * (они взаимоисключающие): по дате логистического возврата переход
     * `MovingToOzon → ReturnedToOzon` не виден — дата не меняется, номер тот же,
     * и второе состояние не приходило никогда. По моменту смены статуса приходит
     * (проверено на живом кабинете: пустое окно 2020 г. → 0, двое суток → 77).
     *
     * @param days ширина окна при ХОЛОДНОМ старте, когда журнал по паре пуст.
     */
    async listReturns(days = 7): Promise<ReturnDto[]> {
        let allReturns: ReturnDto[] = [];
        let lastId = 0;
        let hasNext = true;
        const from = await this.mpEvent.windowStart('OZON', 'RETURN', days, PostingService.LCSD_OVERLAP_DAYS);

        while (hasNext) {
            const filter = {
                filter: {
                    visual_status_change_moment: {
                        time_from: DateTime.fromJSDate(from).toISO(),
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

    /**
     * Все записи возврата по ОДНОМУ отправлению, за всю историю.
     *
     * Числитель признака частичности. Окно прогона для этого не годится: записи
     * приезжают порознь, и «пока приехала одна из двух» — не частичный возврат,
     * а незаконченный. Фильтр `posting_numbers[]` рабочий — в отличие от
     * `posting_number` (единственное число), который Ozon молча игнорирует
     * и отдаёт первые 100 возвратов подряд.
     */
    async listReturnsByPosting(postingNumber: string): Promise<ReturnDto[]> {
        const result: ReturnsListDto = await this.ozonApiService.method('/v1/returns/list', {
            filter: { posting_numbers: [postingNumber] },
            limit: 500,
            last_id: 0,
        });
        return result?.returns ?? [];
    }

    /**
     * Сколько единиц в отправлении ПО ДАННЫМ OZON. Знаменатель признака частичности.
     *
     * Намеренно не через `getByPostingNumber`: у того есть фолбэк на нашу базу,
     * а там количества в наших штуках с коэффициентом кратности — упаковка
     * `570615-10` лежит в счёте как `QUAN=10` против одной записи возврата,
     * и полный возврат кратного товара выглядел бы частичным (проверено на проде
     * 10.08: счета 91713 и 91473 — оба ложные срабатывания).
     *
     * @returns null — состав получить не удалось (например, отправление FBO):
     *          судить о частичности нечем, и врать в эту сторону нельзя.
     */
    async getPostingUnits(postingNumber: string): Promise<number | null> {
        try {
            const res = await this.ozonApiService.method('/v3/posting/fbs/get', { posting_number: postingNumber });
            const products = res?.result?.products;
            if (!products?.length) return null;
            return products.reduce((sum: number, product: any) => sum + (Number(product.quantity) || 0), 0);
        } catch (e) {
            this.logger.warn(`состав отправления ${postingNumber} не получен — ${e.message}`);
            return null;
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
