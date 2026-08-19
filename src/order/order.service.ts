import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ProductService } from '../product/product.service';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ResultDto } from '../helpers/dto/result.dto';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { Cron } from '@nestjs/schedule';
import { PostingService } from '../posting/posting.service';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { WbCustomerService } from '../wb.customer/wb.customer.service';
import { ConfigService } from '@nestjs/config';
import { GoodServiceEnum } from '../good/good.service.enum';
import { FirebirdTransaction } from 'ts-firebird';
import { PostingDto } from '../posting/dto/posting.dto';
import { find } from 'lodash';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { MP_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { isShippedToMarketplace } from '../helpers/posting.shipped';
import { isReturnable } from '../interfaces/IReturnable';
import { isFboReconcilable } from '../interfaces/IFboReconcilable';
import { MpService } from '../mp-event/mp-event.service';
import { DateTime } from 'luxon';
import { AccrualWeekService } from '../trade2006.accrual/accrual.week.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FbsPrepareDto, isMarkSubmittable, SubmitResultDto } from '../interfaces/IMarkSubmittable';
import { isShipmentLabelProvider, IShipmentLabelProvider } from '../interfaces/IShipmentLabelProvider';
import { MpEventDto, MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';
import { MarkScanFbsService } from '../invoice/mark-scan-fbs.service';
import { CLAIM_RETURN_STATES, Decision } from '../mp-decision/mp-decision.types';

type OrderStep = 'cancel' | 'returns' | 'package' | 'delivery' | 'reconcile';

@Injectable()
export class OrderService {
    private logger = new Logger(OrderService.name);
    private orderServices: IOrderable[] = [];
    private serviceNames: any = {
        [GoodServiceEnum.OZON]: 'PostingService',
        [GoodServiceEnum.YANDEX]: 'YandexOrderService',
        [GoodServiceEnum.WB]: 'WbOrderService',
    };

    constructor(
        private productService: ProductService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private postingService: PostingService,
        private yandexOrder: YandexOrderService,
        private postingFboService: PostingFboService,
        private wbOrder: WbOrderService,
        private wbCustomer: WbCustomerService,
        private configService: ConfigService,
        private processedCache: ProcessedCacheService,
        private eventEmitter: EventEmitter2,
        private accrualWeekService: AccrualWeekService,
        private mpEvent: MpEventService,
        private mpRunner: MpDecisionRunnerService,
        private markScanService: MarkScanFbsService,
    ) {
        const services = this.configService.get<GoodServiceEnum[]>('SERVICES', []);
        if (services.includes(GoodServiceEnum.WB)) this.orderServices.push(wbOrder);
        if (services.includes(GoodServiceEnum.OZON)) {
            this.orderServices.push(postingFboService);
            this.orderServices.push(postingService);
        }
        if (services.includes(GoodServiceEnum.YANDEX)) this.orderServices.push(yandexOrder);
    }

    getServiceByName(name: GoodServiceEnum): IOrderable | null {
        return find(this.orderServices, (service) => service.constructor.name === this.serviceNames[name]) || null;
    }

    /** Маркетплейс сервиса для журнала MP_EVENT ('OZON' | 'WB' | 'YANDEX'). */
    private mpService(service: IOrderable): MpService {
        const entry = Object.entries(this.serviceNames).find(([, name]) => name === service.constructor.name);
        const key = entry?.[0] as GoodServiceEnum | undefined;
        if (key === GoodServiceEnum.WB) return 'WB';
        if (key === GoodServiceEnum.YANDEX) return 'YANDEX';
        return 'OZON';
    }

    getServiceByBuyerId(buyerId: number, isFbs = true): IOrderable | null {
        return find(
            this.orderServices,
            (service: IOrderable) => service.getBuyerId() === buyerId && service.isFbo() !== isFbs,
        );
    }

    /**
     * Прогон недели: начисления в журнал, затем закрытие счетов по телам продаж.
     *
     * Заменил разбор /v3/finance/transaction/list (Ozon рубит его 08.09.2026).
     * Старый путь брал ПЕРВУЮ операцию по номеру отправления вместо суммы всех
     * (0141528485-0059-8: -213 руб. вместо реальных 5159) и не видел эквайринг,
     * привязанный к заказу. Костыль коррекции отрицательных выкупом убран —
     * by-day отдаёт нетто сразу.
     */
    async updateTransactions(data: TransactionFilterDto): Promise<ResultDto> {
        const from = DateTime.fromJSDate(new Date(data.date.from)).toISODate();
        const to = DateTime.fromJSDate(new Date(data.date.to)).toISODate();
        this.logger.log(`updateTransactions: прогон недели ${from} … ${to}`);

        const report = await this.accrualWeekService.runWeek(from, to);
        this.logger.log(
            `updateTransactions: закрыто ${report.closed.count} счетов на ${report.closed.amount}, ` +
                `не оплачено ${report.unpaid.length}, ждёт ${report.waiting.count}, в письмо ${report.letter.count}`,
        );
        return { isSuccess: report.balanced, message: JSON.stringify(report) };
    }

    async runFboPackageForTesting(posting: PostingDto): Promise<InvoiceDto> {
        if (this.configService.get<string>('NODE_ENV') !== 'development') {
            throw new ForbiddenException('Endpoint доступен только в development.');
        }
        const transaction = await this.invoiceService.getTransaction();
        try {
            const invoice = await this.postingFboService.createInvoice(posting, transaction);
            await transaction.commit(true);
            return invoice;
        } catch (e) {
            await transaction.rollback(true);
            throw e;
        }
    }

    /**
     * Пятиминутный проход. У FBO здесь остаётся только создание счетов по новым заказам:
     * отмены и доставка FBO уехали в суточный крон (итерация 2 плана FBS-выбытия) —
     * это полный перечит 90-дневного окна без фильтра по дате смены статуса
     * (`last_changed_status_date` в `/v3/posting/fbo/list` мёртвый, обмерено),
     * чаще раза в сутки он не даёт ничего, кроме нагрузки.
     */
    // Фаза +2 мин от observeFbsWideWindow (общий runner) — боевое время задаёт cron.setup.ts.
    @Cron('0 2-57/5 * * * *', { name: 'checkNewOrders' })
    async checkNewOrders(): Promise<void> {
        this.cycleFailures = [];
        for (const service of this.orderServices) {
            // Передача КМ вынесена в ручной POST /pickup/:remark/marks. Крон-ретрая нет:
            // марки уже привязаны в БД на скане, результат сборщик видит сразу при нажатии.
            await this.runSteps(service, service.isFbo() ? ['package'] : ['cancel', 'returns', 'package', 'delivery']);
        }
        this.reportCycleFailures('checkNewOrders');
    }

    /**
     * Суточный проход по FBO: отмены (окно 90 дней), доставка и сверка зависших.
     *
     * Порядок шагов значим: `cancel` уводит отменённые счета в доноры (`STATUS=1`), и до сверки
     * они не доживают; `delivery` — штатный путь; `reconcile` последним добирает то, что оба
     * пропустили. Именно `reconcile` закрывает регресс 14–19.08.2026: `delivery` видит только тех,
     * кто в момент прогона висит в `awaiting_deliver`, а этот статус у FBO живёт часы.
     *
     * `withReconcile=false` — для ручного прогона из контроллера: сверка подбирает счета пачками
     * и запускаться должна по расписанию, а не случайным GET-ом.
     */
    // 04:03 — между пятиминутками runner-кронов, см. cron.setup.ts.
    @Cron('0 3 4 * * *', { name: 'checkFboOrdersDaily' })
    async checkFboOrdersDaily(withReconcile = true): Promise<void> {
        this.cycleFailures = [];
        const steps: OrderStep[] = withReconcile ? ['cancel', 'delivery', 'reconcile'] : ['cancel', 'delivery'];
        for (const service of this.orderServices.filter((s) => s.isFbo())) {
            await this.runSteps(service, steps);
        }
        this.reportCycleFailures('checkFboOrdersDaily');
    }

    /**
     * Сбои элементов за прогон — одним письмом, а не по письму на элемент.
     * Раньше их не было в принципе: ошибка рушила весь батч и уходила только в лог.
     */
    private reportCycleFailures(cycle: string): void {
        if (!this.cycleFailures.length) return;
        this.eventEmitter.emit(
            'error.message',
            `Сбои в прогоне ${cycle}: ${this.cycleFailures.length}`,
            this.cycleFailures.join('\n'),
        );
        this.cycleFailures = [];
    }

    /**
     * Транзакция теперь на ЭЛЕМЕНТ, а не на весь прогон: одна упавшая посылка больше
     * не откатывает всё, что успели сделать соседние. Флашеры кеша выполняются после
     * всех шагов — ключ «обработано» ставится только успешным элементам.
     */
    private async runSteps(service: IOrderable, steps: OrderStep[]): Promise<void> {
        const flushers: (() => Promise<void>)[] = [];
        try {
            if (steps.includes('cancel')) await this.cancelOrders(service, flushers);
            if (steps.includes('returns')) await this.processReturns(service, flushers);
            if (steps.includes('package')) await this.packageOrders(service, flushers);
            if (steps.includes('delivery')) await this.deliveryOrders(service, flushers);
            if (steps.includes('reconcile')) await this.reconcileStuckFbo(service);
        } catch (e) {
            // Сюда падают только сбои самих ручек-списков: сбой элемента ловится внутри.
            this.logger.error(e.message + ' IN ' + service.constructor.name);
            this.cycleFailures.push(`${service.constructor.name}: ${e.message}`);
        }
        for (const flush of flushers) {
            try {
                await flush();
            } catch (e) {
                this.logger.error(`Cache flush failed: ${e.message}`);
            }
        }
    }

    /** Одна транзакция на элемент: успех — коммит, ошибка — откат и проброс наверх. */
    private async perItem(fn: (transaction: FirebirdTransaction) => Promise<void>): Promise<void> {
        const transaction = await this.invoiceService.getTransaction();
        try {
            await fn(transaction);
            await transaction.commit(true);
        } catch (e) {
            await transaction.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    async submitFbsMarkCodesForInvoice(invoice: InvoiceDto): Promise<SubmitResultDto | undefined> {
        // Флаг MARK_CODES_ENABLED больше не запирает отгрузку: цепочка Озона нужна и без марок
        // (магазин, немаркированный товар). Проверку наших кодов в БД глушит getAttachedMarkCodesByScode.
        const service = this.getServiceByBuyerId(invoice.buyerId, true);
        if (!isMarkSubmittable(service)) return undefined;
        try {
            return await service.submitFbsMarkCodes(invoice);
        } catch (e) {
            const message = e?.message ?? String(e);
            this.logger.warn(`submitFbsMarkCodes failed for ${invoice.remark}: ${message}`);
            return { ok: false, failed: [{ ki: '*', reason: message }] };
        }
    }

    /** Фаза 1: предпроверка перед передачей КМ (Озон create-or-get). Нет метода (ВБ) → undefined. */
    async prepareFbsMarksForInvoice(invoice: InvoiceDto): Promise<FbsPrepareDto | undefined> {
        // Create-or-get (Озон API) не трогает нашу БД — нужен и на магазине для отгрузки без марок.
        const service = this.getServiceByBuyerId(invoice.buyerId, true);
        if (!isMarkSubmittable(service) || !service.prepareFbsMarks) return undefined;
        try {
            return await service.prepareFbsMarks(invoice);
        } catch (e) {
            const message = e?.message ?? String(e);
            this.logger.warn(`prepareFbsMarks failed for ${invoice.remark}: ${message}`);
            return { ok: false, error: message };
        }
    }

    /** Этикетка отправления (стр.1) через IShipmentLabelProvider. Ветка WB/Ozon — по buyerId счёта. */
    async getShipmentLabelForInvoice(invoice: InvoiceDto): Promise<Buffer> {
        const service = this.getServiceByBuyerId(invoice.buyerId, true);
        if (!isShipmentLabelProvider(service)) {
            throw new BadRequestException('Этикетка отправления недоступна для этого маркетплейса');
        }
        return service.getShipmentLabel(invoice);
    }

    /**
     * Эталонный ШК отправления для сверки IGK==ШК. У маркетплейса без метода
     * (ВБ) — undefined → сверка пропускается.
     */
    async getShipmentBarcodeForInvoice(invoice: InvoiceDto): Promise<string | undefined> {
        const service = this.getServiceByBuyerId(invoice.buyerId, true) as
            | (IOrderable & Partial<IShipmentLabelProvider>)
            | null;
        if (!service?.getShipmentBarcode) return undefined;
        return service.getShipmentBarcode(invoice);
    }

    /** Сбои элементов за текущий прогон крона — уходят одним письмом в конце. */
    private cycleFailures: string[] = [];

    private async processWithCache<T extends { posting_number: string }>(
        cacheName: string,
        service: IOrderable,
        items: T[],
        processor: (item: T) => Promise<void>,
        flushers: (() => Promise<void>)[],
    ): Promise<void> {
        const { failed } = await this.processedCache.process(
            cacheName,
            service.constructor.name,
            items,
            (item) => item.posting_number,
            processor,
            flushers,
        );
        for (const failure of failed) {
            this.logger.error(`${cacheName} ${service.constructor.name} — ${failure}`);
            this.cycleFailures.push(`${cacheName} ${service.constructor.name} — ${failure}`);
        }
    }

    async deliveryOrders(service: IOrderable, flushers: (() => Promise<void>)[]): Promise<void> {
        const deliveringPostings = await service.listAwaitingDelivering();

        await this.processWithCache(
            'delivery',
            service,
            deliveringPostings,
            (posting) =>
                this.perItem(async (transaction) => {
                    const match = await this.invoiceService.findByPosting(posting, transaction);
                    // Путь доставки НЕ безопасен: на проде 18 из 2543 доставленных за 60 дней имеют
                    // единственный счёт с пометкой « отмена FBO» — заказ отменили, счёт отдали
                    // в доноры, а отправление всё-таки доставили. Автоматике тут делать нечего.
                    if (match?.cancelled || match?.closed) {
                        this.eventEmitter.emit(
                            'error.message',
                            'Доставка по помеченному счёту',
                            `${posting.posting_number}: счёт ${match.invoice.id} помечен «${match.mark.trim()}»,` +
                                ` а отправление доставлено — не трогаем, разобрать руками`,
                        );
                        return;
                    }
                    let invoice = match?.invoice ?? null;
                    if (!invoice) {
                        invoice = await service.createInvoice(posting, transaction, flushers);
                    }
                    if (invoice) {
                        // FBO подбираем через хелпер (пропускает счета-недоборы из FBO_SHORTAGE);
                        // не-FBO (FBS/Yandex/WB) — обычный pickup без лишнего запроса.
                        if (service.isFbo()) {
                            await this.invoiceService.pickupFboUnlessShortage(invoice, transaction);
                        } else {
                            await this.invoiceService.pickupInvoice(invoice, transaction);
                        }
                    }
                }),
            flushers,
        );
    }

    /**
     * Сверка зависших FBO-счетов: идём от НАШЕГО долга, а не от списка маркетплейса.
     *
     * Штатный `deliveryOrders` спрашивает «кто у тебя сейчас в `awaiting_deliver`» — статус живёт
     * часы, между суточными прогонами посылка проскакивает, и счёт не подберётся уже никогда
     * (регресс 14–19.08.2026, 498 счетов). Здесь наоборот: берём свои неподобранные счета и
     * спрашиваем, уехали ли они. Пока счёт висит — он попадёт в следующий прогон.
     *
     * Redis-дедупа тут нет и быть не должно: он и есть половина причины, по которой те 498
     * счетов не восстановились сами. Дедуп — сам факт, что подобранный счёт уходит из `STATUS=3`.
     */
    async reconcileStuckFbo(service: IOrderable): Promise<void> {
        // ВБ, Яндекс и Ozon FBS интерфейс не реализуют — для них шаг не существует.
        if (!isFboReconcilable(service)) return;

        const days = this.configService.get<number>('FBO_RECONCILE_DAYS', 30);
        const limit = this.configService.get<number>('FBO_RECONCILE_LIMIT', 200);
        const dry = this.configService.get<boolean>('FBO_RECONCILE_DRY', false) === true;
        const floor = DateTime.now().minus({ days }).startOf('day').toJSDate();

        const stuck = await this.invoiceService.getStuckFboInvoices(service.getBuyerId(), floor, null);
        // Долга нет — в маркетплейс не ходим вовсе.
        if (!stuck.length) return;

        // Окно запроса задаёт наш долг: от самого старого зависшего счёта (выборка уже
        // отсортирована по дате) минус сутки на расхождение даты счёта и даты заказа.
        const since = DateTime.fromJSDate(new Date(stuck[0].date)).minus({ days: 1 }).toJSDate();
        const shipped = await service.listShippedSince(since);

        const batch = stuck.slice(0, limit);
        const picked: string[] = [];
        let skipped = 0;
        for (const invoice of batch) {
            const remark = String(invoice.remark ?? '').trim();
            const status = shipped.get(remark);
            // Не уехал (ещё собирается), отменён или не наш — не трогаем: у каждого своя ветка.
            if (!status) {
                skipped++;
                continue;
            }
            try {
                const done = await this.pickupWithRetry(remark);
                if (done) picked.push(`${invoice.id}/№${invoice.number ?? '?'} ${remark} — ${status}`);
            } catch (e) {
                this.cycleFailures.push(`reconcile ${remark} — ${e?.message ?? e}`);
            }
        }

        const head =
            `Сверка FBO${dry ? ' (сухой прогон)' : ''}: висело ${stuck.length}, ` +
            `взято в прогон ${batch.length}, уехало у маркетплейса ${batch.length - skipped}, ` +
            `подобрано ${picked.length}`;
        this.logger.log(head);
        // Построчно — иначе потом нечем сверить, что именно шаг сделал.
        for (const line of picked) this.logger.log(`  подобран ${line}`);

        // Молчание при «долг есть, подобрано 0» неотличимо от «всё хорошо» — говорим об этом вслух.
        if (picked.length || (batch.length !== skipped && !picked.length)) {
            this.eventEmitter.emit('error.message', 'Сверка зависших FBO', `${head}\n${picked.join('\n')}`);
        }
    }

    /**
     * Подбор одного счёта с перечитыванием состояния В ТОЙ ЖЕ транзакции.
     *
     * Между выборкой списка и подбором проходят минуты (страницы маркетплейса, цикл по счетам),
     * а параллельно работают пятиминутки и решающая таблица: счёт мог уже уехать в доноры.
     * Тот же гард стоит в `deliveryOrders` — сверка обязана его повторять, а не доверять снимку.
     *
     * Дедлок на триггерах `PODBPOS`/`RESERVEDPOS` наблюдался живьём при ручном разборе 19.08
     * (кладовщик работает в Дельфи параллельно), поэтому конфликт блокировки — не ошибка, а повтор.
     */
    private async pickupWithRetry(remark: string): Promise<boolean> {
        const dry = this.configService.get<boolean>('FBO_RECONCILE_DRY', false) === true;
        for (let attempt = 1; attempt <= OrderService.RECONCILE_ATTEMPTS; attempt++) {
            try {
                let done = false;
                await this.perItem(async (transaction) => {
                    const match = await this.invoiceService.findByPosting(remark, transaction);
                    if (!match || match.cancelled || match.closed) return;
                    if (match.invoice.status !== 3) return;
                    if (dry) {
                        done = true;
                        return;
                    }
                    await this.invoiceService.pickupFboUnlessShortage(match.invoice, transaction);
                    done = true;
                });
                return done;
            } catch (e) {
                const message = e?.message ?? String(e);
                const conflict = /deadlock|conflict|lock/i.test(message);
                if (!conflict || attempt === OrderService.RECONCILE_ATTEMPTS) throw e;
                this.logger.warn(`reconcile ${remark}: конфликт блокировки, попытка ${attempt + 1}`);
            }
        }
        return false;
    }

    private static readonly RECONCILE_ATTEMPTS = 3;

    async packageOrders(service: IOrderable, flushers: (() => Promise<void>)[]): Promise<void> {
        const packagingPostings = await service.listAwaitingPackaging();

        await this.processWithCache(
            'packaging',
            service,
            packagingPostings,
            (posting) =>
                this.perItem(async (transaction) => {
                    const match = await this.invoiceService.findByPosting(posting.posting_number, transaction);
                    if (!match) {
                        await service.createInvoice(posting, transaction, flushers);
                        return;
                    }
                    // Счёт есть, но переименован. На проде такого не встречалось (0 из 296 живых
                    // отправлений), поэтому не создаём второй, а показываем случай в логе.
                    if (match.cancelled || match.closed) {
                        this.logger.warn(
                            `${posting.posting_number}: отправление живое, а счёт ${match.invoice.id} помечен` +
                                ` «${match.mark.trim()}» — счёт не создаём, разобрать руками`,
                        );
                    }
                }),
            flushers,
        );
    }

    async cancelOrders(service: IOrderable, flushers: (() => Promise<void>)[]): Promise<void> {
        // Аварийный рубильник новой логики отмен (FBS живёт без флага с 10.08).
        // Выключен → отмены не читаются и НЕ помечаются в Redis: копятся и будут
        // разобраны после включения. FBO не глушим — его путь старый и не менялся.
        if (!service.isFbo() && this.configService.get<boolean>('MP_CANCEL_ACTIONS_ENABLED', true) === false) {
            this.logger.warn(
                `MP_CANCEL_ACTIONS_ENABLED=false: отмены ${service.constructor.name} не обрабатываются ` +
                    'и копятся. Окно отмен 7 дней — не держать выключенным дольше.',
            );
            return;
        }
        const orders = await service.listCanceled();

        await this.processWithCache(
            'cancellations',
            service,
            orders,
            async (order) => {
                // Решающая таблица вхолостую (итерация 5). Отмены FBS считает крон
                // расширенного окна с дедупом по журналу — здесь только FBO, которых
                // он не видит; повтор гасит тот же Redis-кэш, что и саму обработку.
                if (service.isFbo()) await this.mpRunner.observePosting(order.posting_number, 'FBO', 'cancel');
                // Письмо кладовщику отдаётся замыканием и уходит ПОСЛЕ коммита:
                // при откате не будет письма про несделанную отмену.
                let afterCommit: (() => void) | undefined;
                await this.perItem(async (transaction) => {
                    const match = await this.invoiceService.findByPosting(order.posting_number, transaction);
                    if (!match) return;
                    // Раньше здесь стоял isExists с точным равенством PRIM: после первой отмены счёт
                    // переименован, и повторная отмена его просто не находила. Новый предикат находит,
                    // поэтому пропускать уже помеченные надо явно — иначе суффикс ляжет вторым слоем.
                    if (match.cancelled) return;
                    if (match.closed || match.invoice.status === 5) {
                        this.eventEmitter.emit(
                            'error.message',
                            'Отмена закрытого счёта',
                            `${order.posting_number}: счёт №${match.invoice.number ?? '?'} (SCODE ${match.invoice.id}), статус ${match.invoice.status}` +
                                `${match.mark ? `, пометка «${match.mark.trim()}»` : ''} — не трогаем`,
                        );
                        return;
                    }
                    afterCommit = await this.cancelOrder(order, transaction);
                });
                afterCommit?.();
            },
            flushers,
        );
        await this.mpRunner.flush(`cancelOrders/${service.constructor.name}`);
    }

    // flushers больше не нужен: возвраты дедуплицируются журналом, а не Redis-кешем.
    async processReturns(service: IOrderable, _flushers: (() => Promise<void>)[]): Promise<void> {
        // Возвраты умеет тот, кто реализует IReturnable (Озон, ВБ). Яндекс и FBO-сервисы
        // не реализуют — для них шаг пустой, как и раньше (до интерфейса решалось
        // проверкой имени класса).
        if (!isReturnable(service)) {
            return;
        }

        const mpSvc = this.mpService(service);
        const returns = await service.listReturns();

        // Дедуп возвратов переехал с Redis на журнал MP_EVENT (итерация 4). Ключ включает
        // СОСТОЯНИЕ возврата, поэтому переход MovingToOzon → ReturnedToOzon — это новое
        // событие; со старым ключом по номеру второе состояние не приходило никогда.
        // «Обработано» ставится только после всех действий: упало посередине — следующий
        // проход возьмёт снова, а не похоронит, как это делал Redis.
        for (const returnItem of returns) {
            const event: MpEventDto = {
                service: mpSvc,
                kind: 'RETURN',
                extId: String(returnItem.id),
                state: returnItem.visual?.status?.sys_name ?? 'unknown',
                posting: returnItem.posting_number,
                payload: returnItem,
            };
            try {
                const isNew = await this.mpEvent.record(event);
                const handled = await this.mpEvent.isHandled(event);
                const returnsLive = this.mpRunner.returnsEnabled();
                // Решение считается на новом состоянии возврата (одно решение на состояние,
                // а не на каждый пятиминутный проход) — и, при включённых действиях,
                // на недоделанном событии: оно ретраится, пока не помечено в журнале.
                let decision: Decision | null = null;
                if (isNew || (returnsLive && !handled)) {
                    decision = await this.mpRunner.observeReturn(
                        returnItem,
                        await service.returnCounts(returnItem),
                        mpSvc,
                    );
                }
                if (handled) continue;

                // Легаси-путь ниже (донор « отмена FBO») — озоновский: для других
                // маркетплейсов при выключенных возвратах событие копится в журнале
                // без пометки и будет разобрано таблицей после включения флага.
                if (!returnsLive && mpSvc !== 'OZON') continue;

                if (returnsLive) {
                    // Итерация 8: возвраты исполняет решающая таблица (unretire ДО донора,
                    // донор по ReturnedToOzon, TT 3→0 по ReceivedBySeller); старый путь
                    // «донор при любом физическом возврате» выключен вместе с ней.
                    // Потолок прогона или сбой наблюдения — событие возьмётся следующим проходом.
                    if (!decision) continue;
                    const d = decision;
                    if (this.mpRunner.needsExecution(d)) {
                        await this.perItem(async (transaction) => {
                            await this.mpRunner.execute(d, transaction);
                        });
                    }
                    await this.mpEvent.markHandled(event);
                    continue;
                }

                // Старый путь донора не различает записи: до итерации 4 заявочные
                // возвраты (физики нет, товар никуда не ехал) отсеивал сам фильтр
                // выборки по logistic_return_date, с фильтром по смене статуса они
                // приходят — отсеиваем здесь, иначе отклонённая заявка делает донора.
                if (CLAIM_RETURN_STATES.includes(event.state)) {
                    await this.mpEvent.markHandled(event);
                    continue;
                }

                await this.perItem(async (transaction) => {
                    const match = await this.invoiceService.findByPosting(returnItem.posting_number, transaction);
                    // Гейт возврата держится на том, что переименованный счёт не берётся: он уже
                    // отработан. Предикат теперь его находит, поэтому проверяем пометку явно.
                    if (!match || match.mark) return;
                    if (match.invoice.status === 5) {
                        this.eventEmitter.emit(
                            'error.message',
                            'Возврат по закрытому счёту',
                            `${returnItem.posting_number}: счёт №${match.invoice.number ?? '?'} (SCODE ${match.invoice.id}) в статусе 5 — не трогаем`,
                        );
                        return;
                    }
                    // IGK не пишем: NOT1C — атрибут FBO-счёта и стоит там с создания,
                    // FBS-счёту не положен (правило владельца, §1 плана).
                    await this.processInvoiceStatus4(match.invoice, returnItem.posting_number, transaction);
                });
                await this.mpEvent.markHandled(event);
            } catch (e) {
                this.logger.error(`returns ${returnItem.posting_number} (${event.state}) — ${e.message}`);
                this.cycleFailures.push(`returns ${returnItem.posting_number} (${event.state}) — ${e.message}`);
            }
        }
        await this.mpRunner.flush('processReturns');
    }

    /**
     * Возврат по подобранному счёту: счёт → « отмена FBO» + `STATUS=1`, то есть в доноры.
     *
     * Суффикс здесь именно FBO: товар лёг на склад Ozon, и оттуда он уедет FBO-продажей —
     * доноры отбираются как раз по этой пометке. У отмены FBS путь другой (товар лежит
     * у нас), поэтому она сюда больше не заходит.
     */
    private async processInvoiceStatus4(
        invoice: InvoiceDto,
        postingNumber: string,
        transaction: FirebirdTransaction,
    ): Promise<void> {
        if (invoice.status === 4) {
            await this.invoiceService.updatePrim(
                postingNumber,
                postingNumber + MP_ORDER_CANCELLATION_SUFFIX.FBO,
                transaction,
            );
            this.logger.log(`Return ${postingNumber} was returned`);
        } else {
            this.eventEmitter.emit('error.message', 'Return wrong status', `${postingNumber}: status=${invoice.status}`);
        }
    }

    /**
     * Отмена FBS по СОБРАННОЙ посылке (`STATUS=4`). Товар упакован и лежит у нас.
     *
     * Коды возвращаются на склад половинчато: `TT 3→0`, а привязка к строке остаётся —
     * по ней Дельфи при расформировании заставит кладовщика отсканировать содержимое
     * коробки. Счёт помечается « отмена» (НЕ « отмена FBO»): донором он быть не должен,
     * товар физически у нас, а не на складе Ozon. `STATUS=1` — иначе счёт останется
     * подобранным, а расформировать подобранный счёт в Дельфи нельзя.
     */
    private async cancelPickedFbs(
        invoice: InvoiceDto,
        postingNumber: string,
        transaction: FirebirdTransaction,
    ): Promise<() => void> {
        const returned = await this.invoiceService.returnMarkCodesToStock(invoice.id, transaction);
        this.logger.log(`FBS (pickuped) order ${postingNumber} was cancelled, кодов на склад: ${returned}`);
        await this.invoiceService.updatePrim(
            postingNumber,
            postingNumber + MP_ORDER_CANCELLATION_SUFFIX.REGULAR,
            transaction,
        );
        // На магазине кодов нет (returned=0) — про сканирование не пишем, иначе
        // кладовщик ищет несуществующие коды. Письмо уходит после коммита (замыканием).
        const scanNote = returned > 0 ? `, отсканировать коды (их ${returned}) при расформировании` : '';
        return () =>
            this.eventEmitter.emit(
                'error.message',
                'Отменён собранный заказ — разобрать посылку',
                `${postingNumber}: счёт №${invoice.number ?? '?'} (SCODE ${invoice.id}) был собран, заказ отменён.\n` +
                    `Вскрыть посылку, расформировать счёт №${invoice.number ?? invoice.id} в Trade${scanNote}, товар разложить на полку.`,
            );
    }

    /**
     * Отметка «отменён после отгрузки, ждём запись возврата» — в журнал.
     * По ней недельный отчёт напоминает о заказах, возврат которых так
     * и не появился (решение владельца 2026-08-11). Идемпотентна: повтор
     * отмены двигает LAST_SEEN, второй строки не будет.
     */
    private async recordCancelWait(
        postingNumber: string,
        transaction: FirebirdTransaction,
        service: MpService = 'OZON',
    ): Promise<void> {
        await this.mpEvent.record(
            {
                service,
                kind: 'CANCEL_WAIT',
                extId: postingNumber,
                state: 'waiting',
                posting: postingNumber,
            },
            transaction,
        );
    }

    // IGK здесь больше не трогаем (правило владельца: NOT1C — атрибут FBO-счёта,
    // он ставится при создании; FBS-счёту не положен, а старая безусловная запись
    // затирала ШК упаковки и убила IGK как дискриминатор схемы — §1 плана).
    /** Возвращает письмо-замыкание (если есть) — вызывающий шлёт его ПОСЛЕ коммита. */
    async cancelOrder(order: PostingDto, transaction: FirebirdTransaction): Promise<(() => void) | undefined> {
        const invoice = await this.invoiceService.getByPosting(order, transaction);
        if (!invoice) {
            // Гейт cancelOrders нашёл счёт хвосто-устойчивым findByPosting, а точный
            // поиск — нет: PRIM с неизвестным хвостом (не из объекта суффиксов).
            // Бросаем: элемент попадает в письмо сбоев и НЕ помечается в Redis —
            // молчаливый скип похоронил бы отмену навсегда.
            throw new Error(
                `${order.posting_number}: счёт по точному PRIM не найден (неизвестный хвост?) — разобрать руками`,
            );
        }
        if (order.isFbo) {
            // Решение владельца 2026-08-11: подобранный FBO-счёт при отмене ЖДЁТ
            // записи возврата — только она знает, куда поедет товар (склад Ozon →
            // донор, к нам → приём). Ожидание работает только при включённой
            // обработке возвратов таблицей — иначе счёт ждал бы вечно, поэтому
            // до флага живёт старый путь «донор сразу».
            if (invoice.status === 4 && this.mpRunner.returnsEnabled()) {
                await this.recordCancelWait(order.posting_number, transaction);
                this.logger.log(`FBO order ${order.posting_number} cancelled — счёт не трогаем, ждём запись возврата`);
            } else if (invoice.status === 3 || invoice.status === 4) {
                // Недоборный счёт (он в FBO_SHORTAGE) не подбираем и в доноры не отдаём:
                // pickup наличие не проверяет и «подобрал» бы недостающее из воздуха —
                // то же правило, что у доставки (pickupFboUnlessShortage).
                if (await this.invoiceService.isInFboShortage(order.posting_number, transaction)) {
                    this.eventEmitter.emit(
                        'error.message',
                        'Отмена недоборного FBO-счёта — разобрать руками',
                        `${order.posting_number}: счёт №${invoice.number ?? '?'} (SCODE ${invoice.id}) в журнале недоборов — не подобран и донором не помечен`,
                    );
                    return;
                }
                await this.invoiceService.pickupInvoice(invoice, transaction);
                await this.invoiceService.updatePrim(
                    order.posting_number,
                    order.posting_number + MP_ORDER_CANCELLATION_SUFFIX.FBO,
                    transaction,
                );
                this.logger.log(`FBO order ${order.posting_number} was cancelled`);
            } else {
                // Статусы вне набора (0 погашен, 1 уже донор): оживлять такой счёт
                // подбором нельзя — как в решающей таблице, письмо и руки.
                this.eventEmitter.emit(
                    'error.message',
                    'Отмена FBO при неожиданном статусе счёта',
                    `${order.posting_number}: счёт №${invoice.number ?? '?'} (SCODE ${invoice.id}) в STATUS=${invoice.status} — не трогаем, глянуть глазами`,
                );
            }
        } else if (order.service === GoodServiceEnum.WB && isShippedToMarketplace(order)) {
            // ВБ: отказник/отмена после отгрузки НЕ едет к нам — товар остаётся на
            // складе ВБ и продаётся оттуда (решение владельца 17.08). Ждать записи
            // возврата нечего: claims у ВБ — только возвраты после выкупа, по
            // отказнику заявка не создаётся. Счёт сразу в доноры WBFBO-пула;
            // коды остаются на нём (TT=3) и уедут миграцией при FBO-продаже.
            if (invoice.status === 4) {
                await this.invoiceService.updatePrim(
                    order.posting_number,
                    order.posting_number + MP_ORDER_CANCELLATION_SUFFIX.WBFBO,
                    transaction,
                );
                this.logger.log(`WB order ${order.posting_number} отменён после отгрузки — счёт в доноры WBFBO`);
            } else {
                this.eventEmitter.emit(
                    'error.message',
                    'Отмена отгруженного ВБ-заказа при неожиданном статусе счёта',
                    `${order.posting_number}: счёт №${invoice.number ?? '?'} (SCODE ${invoice.id}) в STATUS=${invoice.status}, ` +
                        'а заказ отгружен — не трогаем, глянуть глазами',
                );
            }
        } else if (isShippedToMarketplace(order)) {
            // Товар уже уехал к Ozon. Проверка идёт ПЕРВОЙ: иначе отгруженная
            // посылка со STATUS=3 попала бы в отвязку кодов.
            // Решение владельца 2026-08-11 (заменяет «донор сразу» от 10.08):
            // по отмене НЕЛЬЗЯ понять, куда поедет товар — знает только запись
            // возврата (ReturnedToOzon → донор, ReceivedBySeller → приём у нас).
            // Счёт не трогаем ВОВСЕ: пометка сломала бы обработку возврата (он
            // пропускает помеченные счета). Ждать можно только при включённой
            // обработке возвратов таблицей — до флага живёт старый путь.
            // Замер на проде 10.08: из 115 отмен FBS за 45 дней отгруженных 62.
            if (this.mpRunner.returnsEnabled()) {
                await this.recordCancelWait(order.posting_number, transaction);
                this.logger.log(`FBS order ${order.posting_number} cancelled после отгрузки — ждём запись возврата`);
            } else {
                await this.processInvoiceStatus4(invoice, order.posting_number, transaction);
            }
        } else if (invoice.status === 3) {
            // Товар у нас, сборка не закончена. Коды, насканенные до отмены, снимаем
            // СРАЗУ — тем же путём, что кнопка «отвязать последний»
            // (MARKCODE_DETACH_FOR_FBS), по всем кодам счёта. Всё в транзакции элемента:
            // упало — откатывается и отвязка, и статус, иначе получится «счёт погашен,
            // а коды остались на нём висеть».
            const detached = await this.markScanService.detachAll(invoice, transaction);
            await this.invoiceService.updatePrim(
                order.posting_number,
                order.posting_number + MP_ORDER_CANCELLATION_SUFFIX.REGULAR,
                transaction,
            );
            await this.invoiceService.bulkSetStatus([invoice], 0, transaction);
            this.logger.log(
                `FBS (not pickuped) order ${order.posting_number} was cancelled, отвязано кодов: ${detached}`,
            );
        } else if (invoice.status === 4) {
            // Посылка собрана и лежит у нас: коды на склад, счёт под расформирование.
            return this.cancelPickedFbs(invoice, order.posting_number, transaction);
        } else {
            this.eventEmitter.emit(
                'error.message',
                'Cancel wrong status',
                `${order.posting_number}: status=${invoice.status}`,
            );
        }
    }

    /** Маркетплейс (enum) по buyerId счёта — фронт ветвит флоу по нему, а не по хардкод-id. */
    getServiceEnumByBuyerId(buyerId: number, isFbs = true): GoodServiceEnum | null {
        const service = this.getServiceByBuyerId(buyerId, isFbs);
        if (!service) return null;
        const entry = Object.entries(this.serviceNames).find(([, name]) => name === service.constructor.name);
        return entry ? (entry[0] as GoodServiceEnum) : null;
    }

    async getByPostingNumber(postingNumber: string, buyerId: number): Promise<PostingDto | null> {
        const posting = await this.getServiceByBuyerId(buyerId)?.getByPostingNumber(postingNumber);
        if (posting) posting.service = this.getServiceEnumByBuyerId(buyerId) ?? undefined;
        return posting;
    }

    async getByFboNumber(fboNumber: string): Promise<PostingDto | null> {
        const invoice = await this.invoiceService.getByPosting(fboNumber, null, true);
        if (!invoice) return null;
        const invoiceLines = await this.invoiceService.getInvoiceLines(invoice, null);
        return {
            posting_number: fboNumber,
            status: invoice.status.toString(),
            in_process_at: invoice.date.toString(),
            isFbo: true,
            products: invoiceLines.map((line) => ({
                price: line.price,
                offer_id: `${line.goodCode}${line.whereOrdered ? `-${line.whereOrdered}` : ''}`,
                quantity: line.quantity,
            })),
        };
    }

    /**
     * Получить накладную по ID претензии WB
     * 1. Получаем претензию по ID
     * 2. Извлекаем srid и order_dt
     * 3. Получаем накладную через getInvoiceBySrid
     * @param claimId - UUID претензии
     * @returns Накладная или null
     */
    async getInvoiceByClaimId(claimId: string): Promise<InvoiceDto | null> {
        // Получаем претензию
        const claim = await this.wbCustomer.getClaimById(claimId);

        if (!claim) {
            return null;
        }

        // Извлекаем srid и order_dt из претензии
        const { srid, order_dt } = claim;

        if (!srid || !order_dt) {
            return null;
        }

        // Получаем накладную через WbOrderService
        return this.wbOrder.getInvoiceBySrid({
            dateFrom: order_dt.substring(0, 10), // Берем только дату YYYY-MM-DD
            srid,
        });
    }
}
