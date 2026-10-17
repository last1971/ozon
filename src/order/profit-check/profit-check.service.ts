import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { FirebirdTransaction } from 'ts-firebird';
import { CommandChainAsync } from '../../helpers/command/command.chain.async';
import { goodQuantityCoeff } from '../../helpers/product/product.helpers';
import { InvoiceDto } from '../../invoice/dto/invoice.dto';
import { MpEventService, MpService } from '../../mp-event/mp-event.service';
import { PostingDto } from '../../posting/dto/posting.dto';
import { LoadPendingCommand } from './commands/load-pending.command';
import { ResolveSalePricesCommand } from './commands/resolve-sale-prices.command';
import { LoadPriceContextCommand } from './commands/load-price-context.command';
import { EvaluateCommand } from './commands/evaluate.command';
import { NotifyCommand } from './commands/notify.command';
import { MarkHandledCommand } from './commands/mark-handled.command';
import { INVOICE_CREATED_EVENT, PROFIT_CHECK_KIND, PROFIT_CHECK_PENDING } from './profit-check.constants';
import { SalePriceSources } from './sale-price.sources';
import { ProfitCheckContext, ProfitCheckPayload } from './profit-check.types';

/** Что создание счёта сообщает о себе (Trade2006InvoiceService.createInvoiceFromPostingDto). */
export interface InvoiceCreatedEvent {
    buyerId: number;
    posting: PostingDto;
    invoice: InvoiceDto;
    transaction: FirebirdTransaction | null;
}

/**
 * Прибыльность заказов маркетплейсов (решение владельца 17.10.2026): после создания счёта заказ
 * встаёт в очередь (журнал MP_EVENT, вид PROFIT_CHECK), крон раз в 10 минут считает по тем же
 * данным, что пересчёт цен, и шлёт одно сообщение в тему «цены»:
 *  - предупреждение — цена ниже минимальной больше чем на PROFIT_CHECK_WARN_PERC (1%), но прибыль есть;
 *  - тревога (с пушем) — прибыли нет.
 * Состав и порядок шагов известны только здесь. Очередь в журнале переживает рестарт и держит
 * заказы ВБ, пока статистика не отдаст нашу цену.
 */
@Injectable()
export class ProfitCheckService {
    private readonly logger = new Logger(ProfitCheckService.name);
    private running = false;

    constructor(
        private readonly journal: MpEventService,
        private readonly sources: SalePriceSources,
        private readonly configService: ConfigService,
        private readonly loadPending: LoadPendingCommand,
        private readonly resolvePrices: ResolveSalePricesCommand,
        private readonly loadPriceContext: LoadPriceContextCommand,
        private readonly evaluate: EvaluateCommand,
        private readonly notify: NotifyCommand,
        private readonly markHandled: MarkHandledCommand,
    ) {}

    chain(): CommandChainAsync<ProfitCheckContext> {
        return new CommandChainAsync<ProfitCheckContext>([
            this.loadPending,
            this.resolvePrices,
            this.loadPriceContext,
            this.evaluate,
            this.notify,
            this.markHandled,
        ]);
    }

    /** Хук: счёт по заказу создан — в очередь, той же транзакцией. Сбой хука счёт не роняет. */
    @OnEvent(INVOICE_CREATED_EVENT)
    async enqueue(event: InvoiceCreatedEvent): Promise<void> {
        try {
            const service = this.serviceOf(event);
            if (!service) {
                this.logger.warn(
                    `${event.posting?.posting_number}: площадка не определена — в очередь проверки прибыли не записан`,
                );
                return;
            }
            const source = this.sources.of(service);
            const priceSource = source?.salePriceSource() ?? 'none';
            if (priceSource === 'none') return;
            const payload: ProfitCheckPayload = {
                service,
                buyerId: event.buyerId,
                scode: event.invoice.id,
                invoiceNumber: event.invoice.number ?? null,
                externalId: event.posting.external_id ?? event.posting.posting_number,
                priceSource,
                lines: event.posting.products.map((p) => ({
                    offer_id: p.offer_id,
                    units: Number(p.quantity) || 0,
                    pricePerUnit: parseFloat(String(p.price)) || 0,
                })),
            };
            await this.journal.record(
                {
                    service,
                    kind: PROFIT_CHECK_KIND,
                    extId: event.posting.posting_number,
                    state: PROFIT_CHECK_PENDING,
                    posting: event.invoice.number ? String(event.invoice.number) : undefined,
                    payload,
                },
                event.transaction ?? null,
            );
        } catch (e) {
            this.logger.warn(`${event.posting?.posting_number}: в очередь проверки прибыли не записан — ${e.message}`);
        }
    }

    // Боевое время задаёт cron.setup.ts; минута :04/:14/… — мимо пятиминуток на :00–:03.
    @Cron('0 4/10 * * * *', { name: 'profitCheck' })
    async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const ctx = await this.chain().execute({
                warnPercent: Number(this.configService.get<number>('PROFIT_CHECK_WARN_PERC', 1)),
                lookupHours: Number(this.configService.get<number>('PROFIT_CHECK_LOOKUP_HOURS', 3)),
                items: [],
            });
            if (ctx.items.length) {
                const n = (l: string) => ctx.items.filter((i) => i.level === l).length;
                this.logger.log(
                    `[profit-check] заказов ${ctx.items.length}: норма ${n('ok')}, предупреждений ${n('warn')}, тревог ${n('alert')}, ` +
                        `не проверено ${n('skip')}, ждут цену ${ctx.items.filter((i) => i.deferred).length}`,
                );
            }
        } catch (e) {
            this.logger.error(`проверка прибыльности не выполнена — ${e.message}`);
        } finally {
            this.running = false;
        }
    }

    /** Площадка заказа: явный признак в заказе, иначе по покупателю счёта. */
    private serviceOf(event: InvoiceCreatedEvent): MpService | null {
        const explicit = event.posting.service?.toUpperCase();
        if (explicit === 'OZON' || explicit === 'WB' || explicit === 'YANDEX') return explicit;
        const byBuyer: [string, MpService][] = [
            ['OZON_BUYER_ID', 'OZON'],
            ['WB_BUYER_ID', 'WB'],
            ['YANDEX_BUYER_ID', 'YANDEX'],
        ];
        for (const [key, service] of byBuyer) {
            if (Number(this.configService.get(key)) === Number(event.buyerId)) return service;
        }
        return null;
    }
}

/** Единиц товара в заказе → штук у нас: для сообщения. */
export const unitsToPieces = (offerId: string, units: number) => units * goodQuantityCoeff({ offer_id: offerId });
