import { Inject, Injectable, Logger } from '@nestjs/common';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbOrderDto } from './dto/wb.order.dto';
import { WbOrderStatusDto } from './dto/wb.order.status.dto';
import { DateTime } from 'luxon';
import { ConfigService } from '@nestjs/config';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FirebirdTransaction } from 'ts-firebird';
import { TransactionFilterDate } from '../posting/dto/transaction.filter.dto';
import { ResultDto } from '../helpers/dto/result.dto';
import { first, min, chunk, find } from 'lodash';
import { WbTransactionDto } from './dto/wb.transaction.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, Timeout } from "@nestjs/schedule";
import { WbFboOrder } from './dto/wb.fbo.order';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import Excel from 'exceljs';
import { WbOrderStickersDto } from "./dto/wb.order.stickers.dto";
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { FetchSalesByStickerCommand } from './commands/fetch-sales-by-sticker.command';
import { FetchOrdersByStickerCommand } from './commands/fetch-orders-by-sticker.command';
import { FetchTransactionsCommand } from './commands/fetch-transactions.command';
import { SelectBestIdCommand } from './commands/select-best-id.command';
import { FetchInvoiceByRemarkCommand } from './commands/fetch-invoice-by-remark.command';
import { WbInvoiceQueryDto } from '../order/dto/wb-invoice-query.dto';
import { WbInvoiceSridQueryDto } from '../order/dto/wb-invoice-srid-query.dto';
import { RateLimit, setRateLimitBlocked } from '../helpers/decorators/rate-limit.decorator';
import { IMarkSubmittable, SubmitFailureDto, SubmitResultDto } from '../interfaces/IMarkSubmittable';
import { WbOrderSetKizRequestDto } from './dto/wb.order.set-kiz.dto';
import { FboInvoiceCreatorService } from '../posting.fbo/fbo-invoice-creator.service';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { isMarkCodesEnabled } from '../helpers';
import { GoodServiceEnum } from '../good/good.service.enum';
import { MP_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { MpEventDto, MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';
import { IReturnable } from '../interfaces/IReturnable';
import { ReturnDto } from '../posting/dto/return.dto';
import { WbCustomerService } from '../wb.customer/wb.customer.service';
import { WbClaimDto } from '../wb.customer/dto/wb.claim.dto';
import { wbClaimState, wbEventState, wbShipped } from './wb.status.helper';

/** Событие наблюдателя ВБ: заказ + статусы, нормализованные в журнал. */
interface WbOrderEvent {
    order: WbOrderDto;
    wbStatus: string;
    supplierStatus: string;
    /** 'delivered' | 'cancelled' | сырой wbStatus. */
    state: string;
    shipped: boolean;
    event: MpEventDto;
}

@Injectable()
export class WbOrderService implements IOrderable, IMarkSubmittable, IReturnable {
    private readonly logger = new Logger(WbOrderService.name);
    private postingDtos: Map<string, PostingDto>;
    constructor(
        private api: WbApiService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
        private readonly fetchSalesByStickerCommand: FetchSalesByStickerCommand,
        private readonly fetchOrdersByStickerCommand: FetchOrdersByStickerCommand,
        private readonly fetchTransactionsCommand: FetchTransactionsCommand,
        private readonly selectBestIdCommand: SelectBestIdCommand,
        private readonly fetchInvoiceByRemarkCommand: FetchInvoiceByRemarkCommand,
        private readonly fboInvoiceCreator: FboInvoiceCreatorService,
        private readonly processedCache: ProcessedCacheService,
        private readonly wbCustomer: WbCustomerService,
        private readonly mpEvent: MpEventService,
        private readonly mpRunner: MpDecisionRunnerService,
    ) {
        this.postingDtos = new Map<string, PostingDto>();
    }

    isFbo(): boolean {
        return false;
    }

    @RateLimit(200)
    async list(dateFrom = 0, initialNext = 0, limit = 1000): Promise<WbOrderDto[]> {
        const result = await this.api.method(
            '/api/v3/orders', 'get',
            { next: initialNext, limit, dateFrom }
        );

        // Handle 429 rate limit error
        if (result?.error?.status === 429) {
            const retryAfterMs = result.error.retryAfterMs || 60000;
            this.logger.warn(
                `WB API rate limit hit (429). Blocking list() for ${retryAfterMs}ms. ` +
                `Will retry on next cron iteration.`
            );
            setRateLimitBlocked('WbOrderService', 'list', Date.now() + retryAfterMs);
            return []; // Return empty, next cron will retry
        }

        const orders = result?.orders || [];
        const next = result?.next;

        // Protect against infinite loop: stop if next equals current cursor
        if (next && next !== initialNext) {
            orders.push(...(await this.list(dateFrom, next, limit)));
        }
        return orders;
    }

    async getAllFboOrders(day = 2, flag = 0): Promise<WbFboOrder[]> {
        const date = DateTime.now().minus({ day });
        return this.api.method('/api/v1/supplier/orders', 'statistics', {
            dateFrom: date.toISODate(),
            flag,
        });
    }
    async getOnlyFboOrders(day = 2, flag = 0): Promise<WbFboOrder[]> {
        const allOrders = await this.getAllFboOrders(day, flag);
        const date = DateTime.now().minus({ day });
        const fbsOrders = await this.list(date.toUnixInteger());
        const fbsRids = fbsOrders.map((order) => order.rid);
        return allOrders.filter((order) => !fbsRids.includes(order.srid));
    }
    @Cron('0 */5 * * * *', { name: 'checkFboWbOrders' })
    async addFboOrders(): Promise<boolean> {
        const allFboOrders = await this.getOnlyFboOrders(7);
        const processed = await this.processedCache.load('fbo-orders', WbOrderService.name);
        const oldFboOrders: boolean[] = await Promise.all(
            allFboOrders.map((order) => this.invoiceService.isExists(order.srid, null)),
        );
        const newFboOrders = allFboOrders.filter(
            (order, index) => !processed.has(order.srid) && !oldFboOrders[index] && !order.isCancel,
        );
        const transaction = await this.invoiceService.getTransaction();
        const buyerId = this.getBuyerId();
        const addFboOrders: WbFboOrder[] = [];
        const useMigration = this.isMarkCodesEnabled();
        // Письма о недоборе шлём после commit (не уведомляем при откате батча).
        const flushers: (() => Promise<void>)[] = [];
        try {
            for (const order of newFboOrders) {
                if (order.supplierArticle === 'wh-service-podmena') continue;
                const product: ProductPostingDto = {
                    price: order.totalPrice.toString(),
                    offer_id: order.supplierArticle,
                    quantity: 1,
                };
                const posting: PostingDto = {
                    posting_number: order.srid,
                    status: 'fbo',
                    in_process_at: order.date,
                    products: [product],
                };
                const invoice = await this.fboInvoiceCreator.create({
                    service: GoodServiceEnum.WB,
                    posting,
                    prims: ['WBFBO'],
                    primLabel: 'WBFBO',
                    buyerId,
                    useMigration,
                    setIgkNot1c: false,
                    pickupAfterCreate: true,
                    skipIfNoPodbor: true,
                    transaction,
                    flushers,
                });
                // Счёт создан только при наличии подбора; недостача/«левый» заказ → null (журнал/пропуск).
                if (invoice) {
                    addFboOrders.push(order);
                    processed.add(order.srid);
                }
            }
            await transaction.commit(true);
            // Запись в Redis только после успешного commit
            await this.processedCache.save('fbo-orders', WbOrderService.name, processed);
            // Письма о недоборе — после commit
            for (const flush of flushers) {
                try {
                    await flush();
                } catch (e) {
                    this.logger.error(`WB FBO shortage notify failed: ${e.message}`);
                }
            }
            if (addFboOrders.length > 0) {
                this.eventEmitter.emit(
                    'wb.order.content',
                    'Добавлены WB FBO заказы',
                    addFboOrders.map((order) => ({ prim: order.srid, offer_id: order.supplierArticle })),
                );
            }
            return true;
        } catch (e) {
            await transaction.rollback(true);
            console.log(e);
            return false;
        }
    }

    private isMarkCodesEnabled(): boolean {
        return isMarkCodesEnabled(this.configService);
    }

    /**
     * Отмены ВБ-FBO (статистика, окно 90 дней). ТОЛЬКО FBO: отмены FBS ведёт общий
     * конвейер `cancelOrders` через `listCanceled()` — прежняя подмена srid→номер
     * задания и пометка FBS-счетов отсюда убраны, чтобы отмена шла одним путём.
     * Суффикс — из единого объекта (легаси ` возврат WBFBO` больше не пишется,
     * но распознаётся как отменённый).
     */
    @Cron('0 */5 * * * *', { name: 'checkCanceledWbOrders' })
    async checkCanceledOrders(): Promise<void> {
        const allFboOrders = await this.getAllFboOrders(90);
        const allCanceledFboOrders = allFboOrders.filter((order) => order.isCancel);
        const dateFrom = min(
            allCanceledFboOrders
                .map((t) => t.date)
                .filter((date) => !!date)
                .map((date) => DateTime.fromISO(date).toUnixInteger()),
        );
        const orders = await this.list(dateFrom);
        const fbsSrids = new Set(orders.map((o) => o.rid));
        const fboCancels = allCanceledFboOrders.filter((order) => !fbsSrids.has(order.srid));
        const processed = await this.processedCache.load('fbo-cancellations', WbOrderService.name);
        const offerIds = new Map<string, string>();
        for (const order of fboCancels) {
            const prim = order.srid;
            if (processed.has(prim)) continue;
            if (await this.invoiceService.isExists(prim, null)) {
                await this.invoiceService.updatePrim(prim, prim + MP_ORDER_CANCELLATION_SUFFIX.WBFBO, null);
                processed.add(prim);
                offerIds.set(prim, order.supplierArticle);
            }
        }
        await this.processedCache.save('fbo-cancellations', WbOrderService.name, processed);
        if (offerIds.size > 0) {
            this.eventEmitter.emit(
                'wb.order.content',
                'Отменены WB FBO заказы',
                Array.from(offerIds.keys()).map((prim) => ({ prim, offer_id: offerIds.get(prim) })),
            );
        }
    }

    async listSomeDayAgo(days = 5): Promise<WbOrderDto[]> {
        const dateFrom = DateTime.now().minus({ days }).toUnixInteger();
        return this.list(dateFrom);
    }

    /** Окно наблюдения по дате создания заказа: отказ при вручении приходит и через недели. */
    private static readonly OBSERVE_WINDOW_DAYS = 30;
    /** Окно ДЕЙСТВИЙ по отменам: от «отмена впервые увидена» (журнал), не от createdAt. */
    private static readonly CANCEL_ACTION_WINDOW_DAYS = 7;
    /**
     * Маркер завершённого посева журнала наблюдателем. Отмены, впервые увиденные
     * НЕ ПОЗЖЕ его FIRST_SEEN, — накопленный хвост: первый прогон после выката
     * поднял бы весь месяц отмен в действия одним махом (доноры, отвязки, письма).
     * Хвост остаётся наблюдению и недельному отчёту.
     */
    private static readonly SEED_EVENT: MpEventDto = {
        service: 'WB',
        kind: 'POSTING_FBS',
        extId: '__OBSERVE_SEED__',
        state: 'seeded',
    };

    /**
     * Наблюдатель продаж и отмен ВБ-FBS — аналог `observeFbsWideWindow` Озона.
     * Заказы окна → статусы батчами ≤1000 → журнал MP_EVENT → продажи исполняет
     * общий `handleDelivered` (retire под MP_SALE_ACTIONS_ENABLED), отмены только
     * наблюдаются (исполняет конвейер `cancelOrders`).
     *
     * Минута :03 — своя: :00/:05 и :02/:07 заняты кронами, кормящими тот же
     * runner-буфер (общий flush и потолок решений). Боевое время задаёт cron.setup.ts.
     */
    @Cron('0 3-58/5 * * * *', { name: 'observeWbFbs' })
    async observeWbFbs(): Promise<void> {
        if (!this.configService.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.WB)) return;
        try {
            const events = await this.fetchOrderEvents();
            for (const ev of events) {
                let isNew = false;
                try {
                    isNew = await this.mpEvent.record(ev.event);
                } catch (e) {
                    this.logger.warn(`журнал: ${ev.event.extId}/${ev.state} не записан — ${e.message}`);
                    continue;
                }
                // Только НОВЫЕ события: sold у ВБ терминален и висит всё окно —
                // без гейта каждый прогон гонял бы isHandled-SELECT по сотням
                // заказов. Ретрай недоделанного делает добор из журнала ниже.
                if (!isNew) continue;
                if (ev.state === 'delivered') {
                    if (!this.mpRunner.salesEnabled()) {
                        await this.mpRunner.observePosting(ev.event.extId, 'FBS', 'delivered', ev.shipped, 'WB');
                        continue;
                    }
                    await this.mpRunner.handleDelivered(ev.event);
                } else if (ev.state === 'cancelled') {
                    // Отмены исполняет конвейер cancelOrders — здесь наблюдение.
                    // Наблюдатель — ЕДИНСТВЕННЫЙ писатель WB-событий (listCanceled
                    // журнал только читает), поэтому isNew здесь надёжен.
                    await this.mpRunner.observePosting(ev.event.extId, 'FBS', 'cancel', ev.shipped, 'WB');
                }
            }
            // Маркер «посев состоялся»: его FIRST_SEEN — граница между накопленным
            // хвостом отмен (разбор руками/отчётом) и живыми отменами (конвейер).
            // Ставится ПОСЛЕ полного посева окна; record идемпотентен.
            await this.mpEvent.record(WbOrderService.SEED_EVENT);
            // Добор из журнала: sold, осевший необработанным (например, простой сервиса
            // дольше окна заказов). Журнал — единственная память о таком событии.
            if (this.mpRunner.salesEnabled()) {
                try {
                    const tail = await this.mpEvent.listUnhandled('WB', 'POSTING_FBS', 'delivered');
                    for (const row of tail) {
                        await this.mpRunner.handleDelivered({
                            service: 'WB',
                            kind: 'POSTING_FBS',
                            extId: row.extId,
                            state: 'delivered',
                            posting: row.posting ?? row.extId,
                        });
                    }
                } catch (e) {
                    this.logger.warn(`ВБ: добор проданного из журнала не прошёл — ${e.message}`);
                }
            }
        } finally {
            await this.mpRunner.flush('observeWbFbs');
        }
    }

    /** Заказы окна наблюдения со статусами, нормализованные в события журнала. */
    private async fetchOrderEvents(): Promise<WbOrderEvent[]> {
        const orders = await this.list(DateTime.now().minus({ days: WbOrderService.OBSERVE_WINDOW_DAYS }).toUnixInteger());
        const statuses: WbOrderStatusDto[] = (
            await Promise.all(
                chunk(orders, 1000).map((chunkOrders: WbOrderDto[]) =>
                    this.orderStatuses(chunkOrders.map((order) => order.id)),
                ),
            )
        ).flat();
        const byId = new Map(statuses.map((s) => [s.id, s]));
        return orders.flatMap((order) => {
            const st = byId.get(order.id);
            if (!st) return [];
            const state = wbEventState(st.wbStatus);
            return [
                {
                    order,
                    wbStatus: st.wbStatus,
                    supplierStatus: st.supplierStatus,
                    state,
                    shipped: wbShipped(st.supplierStatus),
                    event: {
                        service: 'WB',
                        kind: 'POSTING_FBS',
                        extId: String(order.id),
                        state,
                        posting: String(order.id),
                    } as MpEventDto,
                },
            ];
        });
    }

    async orderStatuses(orders: number[]): Promise<WbOrderStatusDto[]> {
        const res = await this.api.method('/api/v3/orders/status', 'post', { orders });
        return res.orders;
    }

    public transformToPostingDto(order: WbOrderDto, status: string, shipped?: boolean): PostingDto {
        const res: PostingDto = {
            posting_number: order.id.toString(),
            status: status,
            in_process_at: order.createdAt,
            service: GoodServiceEnum.WB,
            ...(shipped === undefined ? {} : { shipped }),
            products: [
                {
                    price: (order.convertedPrice / 100).toString(),
                    offer_id: order.article,
                    quantity: 1,
                },
            ],
        };
        // Кэш живёт для getByPostingNumber; без предела он растёт бесконечно.
        if (this.postingDtos.size > 5000) this.postingDtos.clear();
        this.postingDtos.set(res.posting_number, res);
        return res;
    }

    async listByStatus(orders: WbOrderDto[], status: string): Promise<PostingDto[]> {
        const statuses: WbOrderStatusDto[] = (
            await Promise.all(
                chunk(orders, 1000).map((chunkOrders: WbOrderDto[]) =>
                    this.orderStatuses(chunkOrders.map((order) => order.id)),
                ),
            )
        )
            .flat()
            .filter((status: any) => {
                return !['canceled_by_client', 'declined_by_client'].includes(status.wbStatus);
            });
        return orders
            .filter((order) => !!find(statuses, { id: order.id, supplierStatus: status }))
            .map((order) => this.transformToPostingDto(order, status));
    }

    createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.getBuyerId();
        // this.eventEmitter.emit('wb.order.created', posting);
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }

    async listAwaitingDelivering(): Promise<PostingDto[]> {
        const orders = await this.listSomeDayAgo();
        return this.listByStatus(orders, 'complete');
    }

    async listAwaitingPackaging(): Promise<PostingDto[]> {
        const orders = await this.listSomeDayAgo();
        const newOrders = await this.listByStatus(orders, 'new');
        const confirmOrders = await this.listByStatus(orders, 'confirm');
        return newOrders.concat(confirmOrders);
    }

    @RateLimit(60000)
    async getTransactions(data: TransactionFilterDate, rrdid = 0): Promise<Array<WbTransactionDto>> {
        // WB на пустой период отдаёт 204 No Content → axios кладёт пустую строку
        const res = await this.api.method(
            '/api/v5/supplier/reportDetailByPeriod',
            'statistics',
            {
                dateFrom: data.from,
                dateTo: data.to,
                rrdid,
            },
        );
        return Array.isArray(res) ? res : [];
    }

    async getTransactionsFromFile(file: Express.Multer.File): Promise<Array<WbTransactionDto>> {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(file.buffer as any);
        const worksheet: Excel.Worksheet = first(workbook.worksheets);
        const ret: WbTransactionDto[] = [];
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (rowNumber !== 1) {
                ret.push({
                    ppvz_for_pay: row.getCell(34).value as number,
                    delivery_rub: row.getCell(37).value as number,
                    additional_payment: row.getCell(42).value as number,
                    penalty: row.getCell(41).value as number,
                    order_dt: row.getCell(12).value as string,
                    assembly_id: row.getCell(54).value as number,
                    rrd_id: null,
                    srid: row.getCell(57).value as string,
                });
            }
        });
        return ret;
    }
    async updateTransactions(data: TransactionFilterDate, file: Express.Multer.File): Promise<ResultDto> {
        const transactions = file ? await this.getTransactionsFromFile(file) : await this.getTransactions(data);
        const commissions = new Map<string, number>();
        transactions.forEach((t) => {
            const number = t.assembly_id ? t.assembly_id.toString() : t.srid;
            let amount = commissions.get(number) ?? 0;
            const { ppvz_for_pay = 0, delivery_rub = 0, additional_payment = 0, penalty = 0 } = t;
            amount += ppvz_for_pay - delivery_rub + additional_payment - penalty;
            commissions.set(number, amount);
        });
        for (const key of commissions.keys()) {
            if (commissions.get(key) <= 0) {
                commissions.delete(key);
            }
        } 
        return commissions.size > 0 
        ? this.invoiceService.updateByCommissions(commissions, null)
        : {
            isSuccess: false,
            message: 'Нет комиссий для обновления',
        };
    }

    @RateLimit(60000)
    async getSales(dateFrom: string): Promise<any> {
        return this.api.method('/api/v1/supplier/sales', 'statistics', { dateFrom });
    }

    @RateLimit(60000)
    async getOrders(dateFrom: string, flag: number = 0): Promise<any> {
        return this.api.method('/api/v1/supplier/orders', 'statistics', { dateFrom, flag });
    }
    /**
     * Отмены ВБ-FBS для общего конвейера `cancelOrders`.
     *
     * Журнал только ЧИТАЕМ — единственный писатель WB-событий это наблюдатель
     * (`observeWbFbs`): двух писателей разнесённые минуты не спасают от гонки
     * SELECT-then-INSERT по первичному ключу.
     *
     * Окно действий считается от «отмена впервые увидена» (FIRST_SEEN журнала),
     * а НЕ от даты создания заказа: статус отмены у ВБ терминальный и виден всё
     * окно заказов, а отказ при вручении случается через 1–3+ недели после
     * создания — окно по createdAt систематически теряло бы именно его.
     *
     * Гейты по порядку:
     *  - посева ещё не было (маркер пуст) → действий нет вовсе;
     *  - отмена не посеяна наблюдателем → придёт следующим прогоном (≤5 мин);
     *  - отмена увидена не позже посева → накопленный хвост, разбор руками/отчётом;
     *  - старше окна действий → только наблюдение.
     */
    async listCanceled(): Promise<PostingDto[]> {
        const seededAt = await this.mpEvent.firstSeen(WbOrderService.SEED_EVENT);
        if (!seededAt) return [];
        const events = await this.fetchOrderEvents();
        const res: PostingDto[] = [];
        for (const ev of events) {
            if (ev.state !== 'cancelled') continue;
            const firstSeen = await this.mpEvent.firstSeen(ev.event);
            if (!firstSeen || firstSeen <= seededAt) continue;
            const ageDays = -DateTime.fromJSDate(firstSeen).diffNow('days').days;
            if (ageDays > WbOrderService.CANCEL_ACTION_WINDOW_DAYS) continue;
            res.push(this.transformToPostingDto(ev.order, ev.wbStatus, ev.shipped));
        }
        return res;
    }

    /**
     * Возвраты после выкупа (IReturnable): заявки покупателей с returns-api
     * (активные и архив — терминальные статусы только в архиве), нормализованные
     * в озоновский словарь состояний (`wb.status.helper`). Матчинг заявки к счёту:
     * `srid` заявки === `rid` заказа → номер задания (он в S.PRIM у FBS-счетов).
     */
    /** Глубина, на которую /api/v3/orders реально отдаёт историю (проверено боем). */
    private static readonly ORDERS_DEPTH_DAYS = 120;

    /** Все заявки одного среза (активные или архив) с пагинацией — обрезать архив молча нельзя. */
    private async listClaims(isArchive: boolean): Promise<{ claim: WbClaimDto; isArchive: boolean }[]> {
        const pageSize = 200;
        const res: { claim: WbClaimDto; isArchive: boolean }[] = [];
        for (let offset = 0; ; offset += pageSize) {
            const page = await this.wbCustomer.getClaims({ is_archive: isArchive, limit: pageSize, offset });
            const claims = page?.claims ?? [];
            res.push(...claims.map((claim) => ({ claim, isArchive })));
            const total = page?.total ?? res.length;
            if (!claims.length || res.length >= total) return res;
        }
    }

    async listReturns(): Promise<ReturnDto[]> {
        const [active, archived] = await Promise.all([this.listClaims(false), this.listClaims(true)]);
        const claims = [...active, ...archived];
        if (!claims.length) return [];

        // Заказы с даты самой ранней заявки (order_dt в заявке есть всегда), но не
        // глубже отдачи /api/v3/orders: древний архив и битые даты не должны
        // превращать каждый прогон в выкачку всей истории.
        const depthEdge = DateTime.now().minus({ days: WbOrderService.ORDERS_DEPTH_DAYS });
        const orderDts = claims
            .map(({ claim }) => DateTime.fromISO(claim.order_dt).minus({ day: 1 }))
            .filter((dt) => dt.isValid);
        const from = min(orderDts.map((dt) => (dt < depthEdge ? depthEdge : dt).toUnixInteger())) ?? depthEdge.toUnixInteger();
        const orders = await this.list(from);
        const bySrid = new Map(orders.map((o) => [o.rid, o]));

        const res: ReturnDto[] = [];
        for (const { claim, isArchive } of claims) {
            const state = wbClaimState(claim, isArchive);
            if (state === null) continue; // заявка на рассмотрении — события ещё нет
            const order = bySrid.get(claim.srid);
            if (!order) {
                const tooDeep = DateTime.fromISO(claim.order_dt) < depthEdge;
                // Глубже отдачи заказов заявка не сматчится уже никогда — не warn'им
                // о ней каждые 5 минут (архив «живёт» в выборке вечно).
                if (!tooDeep) {
                    this.logger.warn(
                        `ВБ возврат ${claim.id}: заказ по srid ${claim.srid} не найден в окне заказов — пропускаю`,
                    );
                }
                continue;
            }
            res.push({
                id: claim.id,
                posting_number: String(order.id),
                schema: 'Fbs',
                order_number: claim.srid,
                visual: { status: { id: claim.status_ex, sys_name: state, display_name: state } },
            });
        }
        return res;
    }

    /** Частичность возвратов ВБ не судим: одно задание = одна единица товара. */
    async returnCounts(_item: ReturnDto): Promise<{ returnedRows: number; postingUnits: number } | undefined> {
        return undefined;
    }

    async getByPostingNumber(postingNumber: string): Promise<PostingDto> {
        let res = this.postingDtos.get(postingNumber);
        if (!res) {
            await this.listAwaitingPackaging();
            res = this.postingDtos.get(postingNumber);
        }
        return res;
    }

    getBuyerId(): number {
        return this.configService.get<number>('WB_BUYER_ID', 24532);
    }

    async getOrdersStickers(orders: number[]): Promise<WbOrderStickersDto> {
        try {
            const res = await this.api.method(
                '/api/v3/orders/stickers?type=svg&width=58&height=40',
                'post',
                { orders },
            );
            const { stickers } = res;
            return {
                stickers,
                success: true,
                error: null,
            };
        } catch (e) {
            return {
                stickers: [],
                success: false,
                error: (e as Error).message || 'Неизвестная ошибка',
            };
        }
    }

    async getInvoiceBySticker(query: WbInvoiceQueryDto): Promise<InvoiceDto | null> {
        const { dateFrom, stickerId } = query;

        const chain = new CommandChainAsync([
            this.fetchSalesByStickerCommand,      // Ищем в sales
            this.fetchOrdersByStickerCommand,     // Ищем в orders (только если не нашли в sales)
            this.fetchTransactionsCommand,        // Получаем assembly_id по srid
            this.selectBestIdCommand,             // Выбираем assembly_id или srid
            this.fetchInvoiceByRemarkCommand,     // Ищем накладную
        ]);

        const context = await chain.execute({
            dateFrom: new Date(dateFrom),
            stickerId,
        });

        return context.invoice || null;
    }

    async setOrderKiz(orderId: number, sgtins: string[]): Promise<any> {
        const body: WbOrderSetKizRequestDto = { sgtins };
        return this.api.method(`/api/v3/orders/${orderId}/meta/sgtin`, 'put', body);
    }

    async submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto> {
        const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, null);
        if (attached.length === 0) return { ok: true };

        const orderId = parseInt(invoice.remark, 10);
        if (!orderId || Number.isNaN(orderId)) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: `некорректный orderId: ${invoice.remark}` }],
                skipRetry: true,
            };
        }

        // Per-order GET /orders/{id}/meta в API v3 нет (WB отвечает 405, Allow: DELETE):
        // requiredMeta отдаётся только в списке /orders/new. Но сюда мы попадаем лишь при
        // attached.length > 0 — на заказе есть привязанные КМ, значит товар маркируемый и
        // sgtin требуется. Поэтому сразу привязываем КИЗ через PUT /orders/{id}/meta/sgtin.
        const sgtins: string[] = [];
        const failed: SubmitFailureDto[] = [];
        for (const a of attached) {
            const full = await this.invoiceService.getKmFullByKi(a.ki, null);
            if (!full) failed.push({ ki: a.ki, reason: 'KM_FULL пуст' });
            else sgtins.push(full);
        }

        if (sgtins.length === 0) return { ok: false, failed };
        if (sgtins.length > 100) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: '>100 КМ, нужен batching' }],
                skipRetry: true,
            };
        }

        // WbApiService на ошибке не бросает, а возвращает { status:'NotOk', error }.
        // Ловим это явно, иначе неотправленный КИЗ (405 и т.п.) уедет как ok:true,
        // крон закэширует заказ отправленным и повтора не будет.
        const resp = await this.setOrderKiz(orderId, sgtins);
        if (resp?.status === 'NotOk' || resp?.error) {
            const err = resp?.error ?? {};
            return {
                ok: false,
                failed: [
                    ...failed,
                    {
                        ki: '*',
                        reason: `WB meta/sgtin: ${err.status ?? ''} ${err.message ?? err.service_message ?? ''}`.trim(),
                    },
                ],
            };
        }

        return failed.length === 0 ? { ok: true } : { ok: false, failed };
    }

    async getInvoiceBySrid(query: WbInvoiceSridQueryDto): Promise<InvoiceDto | null> {
        const { dateFrom, srid } = query;

        // Цепочка без поиска в sales/orders, т.к. srid уже известен
        const chain = new CommandChainAsync([
            this.fetchTransactionsCommand,        // Получаем assembly_id по srid
            this.selectBestIdCommand,             // Выбираем assembly_id или srid
            this.fetchInvoiceByRemarkCommand,     // Ищем накладную
        ]);

        const context = await chain.execute({
            dateFrom: new Date(dateFrom),
            srid,
        });

        return context.invoice || null;
    }
}
