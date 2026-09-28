import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IOrderable } from '../interfaces/IOrderable';
import { PostingDto } from '../posting/dto/posting.dto';
import { YandexApiService } from '../yandex.api/yandex.api.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ProductPostingDto } from '../product/dto/product.posting.dto';
import { InvoiceDto } from '../invoice/dto/invoice.dto';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { ResultDto } from '../helpers/dto/result.dto';
import { StatsOrderRequestDto } from './dto/stats.order.request.dto';
import { OrderStatsDto } from './dto/order.stats.dto';
import { FirebirdTransaction } from 'ts-firebird';
import { GoodServiceEnum } from '../good/good.service.enum';
import { FbsPrepareDto, IMarkSubmittable, SubmitFailureDto, SubmitResultDto } from '../interfaces/IMarkSubmittable';
import { YandexBoxLayoutRequestDto, YandexOrderDto, YandexOrderItemDto } from './dto/yandex.order.dto';
import { PostingPackLine } from '../posting/interfaces/posting-pack-line';
import { findPackLine } from '../posting/pack-line.util';
import { goodCode, goodQuantityCoeff } from '../helpers';
import { MpEventDto, MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';

export enum YandexOrderSubStatus {
    STARTED = 'STARTED',
    READY_TO_SHIP = 'READY_TO_SHIP',
}

export enum YandexOrderStatus {
    CANCELLED = 'CANCELLED',
    DELIVERED = 'DELIVERED',
    DELIVERY = 'DELIVERY',
    PICKUP = 'PICKUP',
    PROCESSING = 'PROCESSING',
    UNPAID = 'UNPAID',
}

@Injectable()
export class YandexOrderService implements IOrderable, IMarkSubmittable, OnModuleInit {
    private readonly logger = new Logger(YandexOrderService.name);
    private campaignId: number;
    /** Страница списка заказов у Яндекса — максимум 50. */
    private static readonly PAGE_LIMIT = 50;
    /** Окно наблюдения продаж по дате обновления заказа: Яндекс отдаёт не больше 30 дней за запрос. */
    private static readonly OBSERVE_WINDOW_DAYS = 30;

    constructor(
        private yandexApi: YandexApiService,
        private vaultService: VaultService,
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private readonly mpEvent: MpEventService,
        private readonly mpRunner: MpDecisionRunnerService,
    ) {}
    async onModuleInit(): Promise<void> {
        if (!this.isEnabled()) {
            return;
        }
        const yandex = await this.vaultService.get('yandex-seller');
        this.campaignId = yandex['electronica-company'] as number;
    }

    private isEnabled(): boolean {
        return this.configService.get<GoodServiceEnum[]>('SERVICES', []).includes(GoodServiceEnum.YANDEX);
    }

    isFbo(): boolean {
        return false;
    }

    /** `api.method` не бросает — отказ приходит объектом `{status:'NotOk', error}`. */
    private static isNotOk(res: any): boolean {
        return !res || res.status === 'NotOk' || !!res.error;
    }

    private static errorText(res: any): string {
        const err = res?.error ?? {};
        return `${err.status ?? ''} ${err.message ?? err.service_message ?? 'нет ответа'}`.trim();
    }

    private toPosting(order: YandexOrderDto): PostingDto {
        return {
            // order.id у Яндекса — ЧИСЛО. Голым числом оно ломало весь дедуп:
            // findByPosting не матчил VARCHAR PRIM числовым параметром, а Set кэша
            // хранит строки — заказ пересоздавался каждый прогон (25 дублей 14.08).
            posting_number: String(order.id),
            status: order.substatus,
            in_process_at: DateTime.fromFormat(order.creationDate, 'dd-LL-y HH:mm:ss').toJSDate().toString(),
            products: order.items.map(
                (item): ProductPostingDto => ({
                    price: item.priceBeforeDiscount as any,
                    offer_id: item.offerId,
                    quantity: item.count,
                }),
            ),
        };
    }

    /**
     * Все страницы списка заказов по фильтру. Раньше брали одну страницу без
     * пагинации — заказы сверх страницы просто не видели.
     */
    async listOrders(params: Record<string, any>): Promise<YandexOrderDto[]> {
        const orders: YandexOrderDto[] = [];
        let pageToken: string | undefined;
        do {
            const data: Record<string, any> = { ...params, limit: YandexOrderService.PAGE_LIMIT };
            if (pageToken) data.pageToken = pageToken;
            const res = await this.yandexApi.method(`campaigns/${this.campaignId}/orders`, 'get', data);
            if (YandexOrderService.isNotOk(res)) {
                throw new Error(`Яндекс orders: ${YandexOrderService.errorText(res)}`);
            }
            orders.push(...(res.orders || []));
            pageToken = res.paging?.nextPageToken || undefined;
        } while (pageToken);
        return orders;
    }

    async list(
        subStatus: YandexOrderSubStatus,
        status: YandexOrderStatus = YandexOrderStatus.PROCESSING,
    ): Promise<PostingDto[]> {
        const data: any = { status };
        if (subStatus) {
            data.substatus = subStatus;
        }
        const orders = await this.listOrders(data);
        return orders.map((order) => this.toPosting(order));
    }
    async listAwaitingPackaging(): Promise<PostingDto[]> {
        return this.list(YandexOrderSubStatus.STARTED);
    }
    async listAwaitingDelivering(): Promise<PostingDto[]> {
        return this.list(YandexOrderSubStatus.READY_TO_SHIP);
    }
    async createInvoice(posting: PostingDto, transaction: FirebirdTransaction): Promise<InvoiceDto> {
        const buyerId = this.getBuyerId();
        return this.invoiceService.createInvoiceFromPostingDto(buyerId, posting, transaction);
    }
    async statsOrder(request: StatsOrderRequestDto, page_token: string = ''): Promise<OrderStatsDto[]> {
        const res = await this.yandexApi.method(
            `campaigns/${this.campaignId}/stats/orders?page_token=${page_token}`,
            'post',
            request,
        );

        const orders: OrderStatsDto[] = res.result.orders || [];

        if (res.result.paging?.nextPageToken) {
            const nextOrders = await this.statsOrder(request, res.result.paging.nextPageToken);
            orders.push(...nextOrders);
        }

        return orders;
    }
    async updateTransactions(): Promise<ResultDto> {
        const buyerId = this.getBuyerId();
        const invoices = await this.invoiceService.getByBuyerAndStatus(buyerId, 4, null);
        const orders = await this.statsOrder({
            statuses: ['DELIVERED'],
            orders: invoices.map((invoice) => parseInt(invoice.remark)),
        });
        const commissions: Map<string, number> = new Map<string, number>();
        orders.forEach((order) => {
            commissions.set(
                order.partnerOrderId,
                order.payments.reduce((accumulator, payment) => accumulator + payment.total, 0) -
                    order.commissions.reduce((accumulator, commission) => accumulator + commission.actual, 0),
            );
        });
        return this.invoiceService.updateByCommissions(commissions, null);
    }

    async listCanceled(): Promise<PostingDto[]> {
        return this.list(null, YandexOrderStatus.CANCELLED);
    }

    /** Один заказ с позициями (`items[].id`, `requiredInstanceTypes`, переданные `instances`). */
    async getOrder(orderId: number): Promise<YandexOrderDto | null> {
        const res = await this.yandexApi.method(`campaigns/${this.campaignId}/orders/${orderId}`, 'get', {});
        if (YandexOrderService.isNotOk(res)) return null;
        return res.order ?? null;
    }

    private static orderId(postingNumber: string): number | null {
        const id = parseInt(postingNumber, 10);
        return !id || Number.isNaN(id) ? null : id;
    }

    async getByPostingNumber(postingNumber: string): Promise<PostingDto> {
        const orderId = YandexOrderService.orderId(postingNumber);
        if (!orderId) return null;
        const order = await this.getOrder(orderId);
        return order ? this.toPosting(order) : null;
    }

    /**
     * Позиции заказа с разложенным артикулом — для сопоставления кодов по фасовке
     * (тот же `findPackLine`, что у Озона: мультипаки одного goodscode различимы только ею).
     * `productId` здесь — id позиции в заказе Яндекса.
     */
    private static packLines(order: YandexOrderDto): PostingPackLine[] {
        return order.items.map((item) => ({
            offerId: String(item.offerId),
            goodscode: goodCode({ offer_id: item.offerId }),
            pieces: goodQuantityCoeff({ offer_id: item.offerId }),
            productId: item.id,
        }));
    }

    private static cisRequired(item: YandexOrderItemDto): boolean {
        return (item.requiredInstanceTypes ?? []).includes('CIS');
    }

    /** Фаза 1 (диалог на фронте): что Яндекс требует по позициям. Без запросов на изменение. */
    async prepareFbsMarks(invoice: InvoiceDto): Promise<FbsPrepareDto> {
        const orderId = YandexOrderService.orderId(invoice.remark);
        if (!orderId) return { ok: false, error: `некорректный номер заказа: ${invoice.remark}` };
        const order = await this.getOrder(orderId);
        if (!order) return { ok: false, error: `заказ ${orderId} у Яндекса не найден` };
        return {
            ok: true,
            multiBoxQty: 1,
            lines: order.items.map((item) => ({
                productId: item.id,
                quantity: item.count,
                markNeeded: YandexOrderService.cisRequired(item),
                gtdNeeded: (item.requiredInstanceTypes ?? []).includes('GTD'),
            })),
        };
    }

    /**
     * «Передать» для Яндекса = коды + «готов к отгрузке» одним нажатием.
     *
     * У Яндекса нет отдельного метода передачи КМ для FBS: коды едут внутри раскладки
     * по коробкам (PUT /boxes), и раскладку можно менять только ДО READY_TO_SHIP.
     * Поэтому порядок жёсткий: boxes (одна коробка, ВСЕ позиции заказа) → status.
     * Статус ставим сами: без кодов Яндекс перевод не пропустит, а кладовщик в ЛК
     * после этой кнопки ничего не жмёт (ярлык печатает в ЛК уже после).
     *
     * Немаркированный заказ (кодов у нас нет): boxes не трогаем — только статус,
     * чтобы не перезаписывать раскладку, если её сделали в ЛК.
     */
    async submitFbsMarkCodes(invoice: InvoiceDto): Promise<SubmitResultDto> {
        const orderId = YandexOrderService.orderId(invoice.remark);
        if (!orderId) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: `некорректный orderId: ${invoice.remark}` }],
                skipRetry: true,
            };
        }
        const order = await this.getOrder(orderId);
        if (!order) {
            return {
                ok: false,
                failed: [{ ki: '*', reason: `заказ ${orderId} у Яндекса не найден` }],
                failedStep: 'get',
            };
        }

        const attached = await this.invoiceService.getAttachedMarkCodesByScode(invoice.id, null);
        const failed: SubmitFailureDto[] = [];

        // Уже не STARTED — раскладка закрыта, boxes менять нельзя.
        if (order.status !== YandexOrderStatus.PROCESSING || order.substatus !== YandexOrderSubStatus.STARTED) {
            const sent = order.items.reduce((sum, item) => sum + (item.instances?.length ?? 0), 0);
            if (attached.length === 0 || sent >= attached.length) {
                return { ok: true, shipped: true, skipped: `заказ уже ${order.status}/${order.substatus ?? ''}` };
            }
            return {
                ok: false,
                skipRetry: true,
                failedStep: 'validate',
                failed: [
                    {
                        ki: '*',
                        reason:
                            `заказ уже ${order.status}/${order.substatus ?? ''}, у Яндекса кодов ${sent} из ${attached.length} — ` +
                            'раскладку менять нельзя, разбираться в ЛК Яндекса',
                    },
                ],
            };
        }

        if (attached.length > 0) {
            // Код → полный КМ (с криптохвостом и GS — Яндекс ждёт именно его).
            const kmFullByKi = new Map<string, string>();
            for (const a of attached) {
                const full = await this.invoiceService.getKmFullByKi(a.ki, null);
                if (!full) failed.push({ ki: a.ki, reason: 'KM_FULL пуст' });
                else kmFullByKi.set(a.ki, full);
            }

            // Код → позиция заказа по goodscode + фасовке.
            const lines = YandexOrderService.packLines(order);
            const cisByItem = new Map<number, string[]>();
            for (const a of attached) {
                const cis = kmFullByKi.get(a.ki);
                if (!cis) continue;
                const line = findPackLine(lines, a.goodscode, a.quantity);
                if (!line) {
                    const known = lines.some((l) => l.goodscode === a.goodscode);
                    failed.push({
                        ki: a.ki,
                        reason: known
                            ? `goodscode ${a.goodscode}: фасовка кода ${a.quantity} не сопоставлена с позицией заказа`
                            : `goodscode ${a.goodscode} не найден в заказе`,
                    });
                    continue;
                }
                if (!cisByItem.has(line.productId)) cisByItem.set(line.productId, []);
                cisByItem.get(line.productId).push(cis);
            }

            // Одна коробка, все позиции. Один код = одна единица Яндекса (штучный или код-упаковка).
            const body: YandexBoxLayoutRequestDto = { boxes: [{ items: [] }] };
            for (const item of order.items) {
                const cis = cisByItem.get(item.id) ?? [];
                if (cis.length > 0 && cis.length !== item.count) {
                    failed.push({
                        ki: '*',
                        reason: `позиция ${item.offerId}: привязано кодов ${cis.length}, Яндекс ждёт ${item.count}`,
                    });
                    continue;
                }
                if (cis.length === 0 && YandexOrderService.cisRequired(item)) {
                    failed.push({ ki: '*', reason: `позиция ${item.offerId}: Яндекс требует КМ, а кодов нет` });
                    continue;
                }
                body.boxes[0].items.push({
                    id: item.id,
                    fullCount: item.count,
                    ...(cis.length ? { instances: cis.map((c) => ({ cis: c })) } : {}),
                });
            }
            // Любой провал сопоставления — ничего не шлём: частичная раскладка у Яндекса
            // означала бы «остальных позиций в заказе нет».
            if (failed.length > 0) return { ok: false, failed, failedStep: 'validate' };

            const boxesRes = await this.yandexApi.method(
                `campaigns/${this.campaignId}/orders/${orderId}/boxes`,
                'put',
                body,
            );
            if (YandexOrderService.isNotOk(boxesRes)) {
                return {
                    ok: false,
                    failedStep: 'boxes',
                    failed: [{ ki: '*', reason: `Яндекс boxes: ${YandexOrderService.errorText(boxesRes)}` }],
                };
            }
        }

        const statusRes = await this.yandexApi.method(`campaigns/${this.campaignId}/orders/${orderId}/status`, 'put', {
            order: { status: YandexOrderStatus.PROCESSING, substatus: YandexOrderSubStatus.READY_TO_SHIP },
        });
        if (YandexOrderService.isNotOk(statusRes)) {
            // Коды уже у Яндекса, статус не встал (напр., код не прошёл проверку ЧЗ) — разбор в ЛК.
            return {
                ok: false,
                failedStep: 'status',
                goToOzon: attached.length > 0,
                failed: [
                    { ki: '*', reason: `Яндекс status READY_TO_SHIP: ${YandexOrderService.errorText(statusRes)}` },
                ],
            };
        }
        return { ok: true, shipped: true };
    }

    /**
     * Наблюдатель продаж Яндекс-FBS: доставленные заказы → журнал MP_EVENT → retire
     * переданных кодов через общую решающую таблицу (как ВБ-наблюдатель).
     * Отмены сюда не входят: их исполняет конвейер cancelOrders, а у Яндекса отменённый
     * заказ всегда возвращается к нам — признак «уехал» ему не нужен (правило владельца 20.09).
     * Минута :04 — своя: :00/:05, :02/:07 и :03 заняты кронами того же runner-буфера.
     * Боевое время задаёт cron.setup.ts.
     */
    @Cron('0 4-59/5 * * * *', { name: 'observeYandexFbs' })
    async observeYandexFbs(): Promise<void> {
        if (!this.isEnabled()) return;
        try {
            const orders = await this.listOrders({
                status: YandexOrderStatus.DELIVERED,
                updatedAtFrom: DateTime.now().minus({ days: YandexOrderService.OBSERVE_WINDOW_DAYS }).toISO(),
                updatedAtTo: DateTime.now().toISO(),
            });
            for (const order of orders) {
                const event: MpEventDto = {
                    service: 'YANDEX',
                    kind: 'POSTING_FBS',
                    extId: String(order.id),
                    state: 'delivered',
                    posting: String(order.id),
                };
                let isNew = false;
                try {
                    isNew = await this.mpEvent.record(event);
                } catch (e) {
                    this.logger.warn(`журнал: ${event.extId}/delivered не записан — ${e.message}`);
                    continue;
                }
                // Только новые: delivered терминален и висит всё окно. Недоделанное добирает хвост ниже.
                if (!isNew) continue;
                if (!this.mpRunner.salesEnabled()) {
                    await this.mpRunner.observePosting(event.extId, 'FBS', 'delivered', undefined, 'YANDEX');
                    continue;
                }
                await this.mpRunner.handleDelivered(event);
            }
            if (this.mpRunner.salesEnabled()) {
                try {
                    const tail = await this.mpEvent.listUnhandled('YANDEX', 'POSTING_FBS', 'delivered');
                    for (const row of tail) {
                        await this.mpRunner.handleDelivered({
                            service: 'YANDEX',
                            kind: 'POSTING_FBS',
                            extId: row.extId,
                            state: 'delivered',
                            posting: row.posting ?? row.extId,
                        });
                    }
                } catch (e) {
                    this.logger.warn(`Яндекс: добор проданного из журнала не прошёл — ${e.message}`);
                }
            }
        } catch (e) {
            this.logger.warn(`Яндекс: наблюдение продаж не прошло — ${e.message}`);
        } finally {
            await this.mpRunner.flush('observeYandexFbs');
        }
    }

    getBuyerId(): number {
        return this.configService.get<number>('YANDEX_BUYER_ID', 24465);
    }
}
