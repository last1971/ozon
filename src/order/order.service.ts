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
import { FirebirdTransaction } from "ts-firebird";
import { PostingDto } from "../posting/dto/posting.dto";
import { find } from 'lodash';
import { ProcessedCacheService } from '../processed-cache/processed-cache.service';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { OZON_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { DateTime } from 'luxon';
import { AccrualWeekService } from '../trade2006.accrual/accrual.week.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FbsPrepareDto, isMarkSubmittable, SubmitResultDto } from '../interfaces/IMarkSubmittable';
import { isShipmentLabelProvider, IShipmentLabelProvider } from '../interfaces/IShipmentLabelProvider';

type OrderStep = 'cancel' | 'returns' | 'package' | 'delivery';

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
    @Cron('0 */5 * * * *', { name: 'checkNewOrders' })
    async checkNewOrders(): Promise<void> {
        for (const service of this.orderServices) {
            // Передача КМ вынесена в ручной POST /pickup/:remark/marks. Крон-ретрая нет:
            // марки уже привязаны в БД на скане, результат сборщик видит сразу при нажатии.
            await this.runSteps(
                service,
                service.isFbo() ? ['package'] : ['cancel', 'returns', 'package', 'delivery'],
            );
        }
    }

    /** Суточный проход по FBO: отмены (окно 90 дней) и доставка. */
    @Cron('0 0 4 * * *', { name: 'checkFboOrdersDaily' })
    async checkFboOrdersDaily(): Promise<void> {
        for (const service of this.orderServices.filter((s) => s.isFbo())) {
            await this.runSteps(service, ['cancel', 'delivery']);
        }
    }

    private async runSteps(service: IOrderable, steps: OrderStep[]): Promise<void> {
        const transaction = await this.invoiceService.getTransaction();
        const flushers: (() => Promise<void>)[] = [];
        try {
            if (steps.includes('cancel')) await this.cancelOrders(service, transaction, flushers);
            if (steps.includes('returns')) await this.processReturns(service, transaction, flushers);
            if (steps.includes('package')) await this.packageOrders(service, transaction, flushers);
            if (steps.includes('delivery')) await this.deliveryOrders(service, transaction, flushers);
            await transaction.commit(true);
            for (const flush of flushers) {
                try {
                    await flush();
                } catch (e) {
                    this.logger.error(`Cache flush failed: ${e.message}`);
                }
            }
        } catch (e) {
            await transaction.rollback(true);
            this.logger.error(e.message + ' IN ' + service.constructor.name);
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

    private async processWithCache<T extends { posting_number: string }>(
        cacheName: string,
        service: IOrderable,
        items: T[],
        processor: (item: T) => Promise<void>,
        flushers: (() => Promise<void>)[],
    ): Promise<void> {
        await this.processedCache.process(
            cacheName,
            service.constructor.name,
            items,
            (item) => item.posting_number,
            processor,
            flushers,
        );
    }

    async deliveryOrders(
        service: IOrderable,
        transaction: FirebirdTransaction,
        flushers: (() => Promise<void>)[],
    ): Promise<void> {
        const deliveringPostings = await service.listAwaitingDelivering();

        await this.processWithCache('delivery', service, deliveringPostings, async (posting) => {
            let invoice = await this.invoiceService.getByPosting(posting, transaction);
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
        }, flushers);
    }

    async packageOrders(
        service: IOrderable,
        transaction: FirebirdTransaction,
        flushers: (() => Promise<void>)[],
    ): Promise<void> {
        const packagingPostings = await service.listAwaitingPackaging();

        await this.processWithCache('packaging', service, packagingPostings, async (posting) => {
            if (!(await this.invoiceService.isExists(posting.posting_number, transaction))) {
                await service.createInvoice(posting, transaction, flushers);
            }
        }, flushers);
    }

    async cancelOrders(
        service: IOrderable,
        transaction: FirebirdTransaction,
        flushers: (() => Promise<void>)[],
    ): Promise<void> {
        const orders = await service.listCanceled();

        await this.processWithCache('cancellations', service, orders, async (order) => {
            if (await this.invoiceService.isExists(order.posting_number, transaction)) {
                await this.cancelOrder(order, transaction);
            }
        }, flushers);
    }

    async processReturns(
        service: IOrderable,
        transaction: FirebirdTransaction,
        flushers: (() => Promise<void>)[],
    ): Promise<void> {
        if (service.constructor.name !== 'PostingService') {
            return;
        }

        const postingService = service as PostingService;
        const returns = await postingService.listReturns();

        await this.processWithCache('returns', service, returns, async (returnItem) => {
            if (await this.invoiceService.isExists(returnItem.posting_number, transaction)) {
                const invoice = await this.invoiceService.getByPosting(returnItem.posting_number, transaction);
                await this.invoiceService.update(invoice, { IGK: 'NOT1C' }, transaction);
                await this.processInvoiceStatus4(invoice, returnItem.posting_number, transaction, 'returned');
            }
        }, flushers);
    }

    private async processInvoiceStatus4(
        invoice: InvoiceDto,
        postingNumber: string,
        transaction: FirebirdTransaction,
        type: 'cancelled' | 'returned',
    ): Promise<void> {
        if (invoice.status === 4) {
            await this.invoiceService.updatePrim(
                postingNumber,
                postingNumber + OZON_ORDER_CANCELLATION_SUFFIX.FBO,
                transaction,
            );
            this.logger.log(`${type === 'cancelled' ? 'FBS (pickuped) order' : 'Return'} ${postingNumber} was ${type}`);
        } else {
            this.eventEmitter.emit(
                'error.message',
                `${type === 'cancelled' ? 'Cancel' : 'Return'} wrong status`,
                `${postingNumber}: status=${invoice.status}`,
            );
        }
    }

    async cancelOrder(order: PostingDto, transaction: FirebirdTransaction): Promise<void> {
        const invoice = await this.invoiceService.getByPosting(order, transaction);
        await this.invoiceService.update(invoice, { IGK: 'NOT1C' }, transaction);
        if (order.isFbo) {
            await this.invoiceService.pickupInvoice(invoice, transaction);
            await this.invoiceService.updatePrim(
                order.posting_number,
                order.posting_number + OZON_ORDER_CANCELLATION_SUFFIX.FBO,
                transaction,
            );
            this.logger.log(`FBO order ${order.posting_number} was cancelled`);
        } else {
            if (invoice.status === 3) {
                await this.invoiceService.updatePrim(
                    order.posting_number,
                    order.posting_number + OZON_ORDER_CANCELLATION_SUFFIX.REGULAR,
                    transaction,
                );
                await this.invoiceService.bulkSetStatus([invoice], 0, transaction);
                this.logger.log(`FBS (not pickuped) order ${order.posting_number} was cancelled`);
            } else {
                await this.processInvoiceStatus4(invoice, order.posting_number, transaction, 'cancelled');
            }
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
        }
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
