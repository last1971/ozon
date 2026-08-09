import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { ProductService } from '../product/product.service';
import { AccrualDto } from '../posting/dto/accrual.dto';
import {
    classifyPending,
    distributeAccruals,
    PendingClassification,
    PendingVerdict,
} from '../helpers/accrual.distribution';
import { AccrualUnpaidDto, AccrualWeekReportDto } from './dto/accrual.week.report.dto';

const amountOf = (a: AccrualDto): number => parseFloat(a.total_amount?.amount ?? '0') || 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const bucket = (list: AccrualDto[]) => ({ count: list.length, amount: round2(list.reduce((s, a) => s + amountOf(a), 0)) });

/** Статус счёта, при котором его можно закрывать оплатой (подобран). */
const INVOICE_READY_STATUS = 4;
/** Насколько назад смотрим дырки в реестре загруженных дней. */
const REGISTRY_LOOKBACK_DAYS = 60;

/**
 * Прогон недели: складываем начисления в журнал, затем закрываем счета по телам.
 *
 * Двух проходов ровно два и они разделены сознательно. Эквайринг Ozon начисляет
 * при оплате заказа, а нетто продажи — при выкупе, и между ними до 8+ дней. Если
 * разносить на лету, эквайринг заказа, чьё тело придёт на следующей неделе,
 * разносить будет не на что, а второй раз Ozon его не пришлёт.
 */
@Injectable()
export class AccrualWeekService {
    private logger = new Logger(AccrualWeekService.name);

    constructor(
        private accrualService: Trade2006AccrualService,
        private invoiceService: Trade2006InvoiceService,
        private productService: ProductService,
        private eventEmitter: EventEmitter2,
    ) {}

    async runWeek(from: string, to: string): Promise<AccrualWeekReportDto> {
        this.logger.log(`Проход 1: выгрузка начислений ${from} … ${to}`);
        const loaded = await this.loadPeriod(from, to);
        this.logger.log(`Проход 1 закончен: ${loaded} начислений в журнале`);
        const missingDays = await this.accrualService.getMissingDays(
            DateTime.fromISO(to).minus({ days: REGISTRY_LOOKBACK_DAYS }).toISODate(),
            to,
        );
        if (missingDays.length) {
            this.logger.warn(`Дырки в реестре загруженных дней: ${missingDays.join(', ')}`);
        }

        this.logger.log('Проход 2: разнесение и закрытие счетов');
        const transaction = await this.invoiceService.getTransaction();
        try {
            const unsettled = await this.accrualService.getUnsettled(transaction);
            this.logger.log(`Поднято неразнесённых записей: ${unsettled.length}`);

            const { settlements, returns, pending, unattributed } = distributeAccruals(unsettled);
            this.logger.log(
                `Разложено: тел ${settlements.length}, ждут тела ${pending.length}, ` +
                    `возвраты ${returns.length}, в письмо ${unattributed.length}`,
            );

            const { closed, unpaid, cancelledIds } = await this.closeInvoices(settlements, transaction);
            await this.accrualService.setVerdict(cancelledIds, PendingVerdict.RETURNED, transaction);

            this.logger.log(`Разбираю ${pending.length} ожидающих по состоянию счетов`);
            const verdicts = await this.classify(pending, to);
            await this.accrualService.applyVerdicts(verdicts, transaction);

            this.logger.log('Коммит');
            await transaction.commit(true);

            const byVerdict = (...kinds: PendingVerdict[]) =>
                bucket(verdicts.filter((v) => kinds.includes(v.verdict)).map((v) => v.accrual));
            const report: AccrualWeekReportDto = {
                period: { from, to },
                loaded,
                missingDays,
                closed,
                unpaid,
                waiting: byVerdict(PendingVerdict.WAITING, PendingVerdict.STALE),
                late: byVerdict(PendingVerdict.CLOSED, PendingVerdict.NO_INVOICE),
                // сторно из разнесения ПЛЮС ожидавшие, чей счёт оказался отменён:
                // без второго слагаемого контроль расходится ровно на их сумму
                returns: bucket([
                    ...returns,
                    ...verdicts.filter((v) => v.verdict === PendingVerdict.RETURNED).map((v) => v.accrual),
                ]),
                letter: bucket(unattributed),
                balanced: false,
            };
            report.balanced = this.isBalanced(unsettled, report, unpaid);
            this.sendLetter(report, unattributed);
            return report;
        } catch (e) {
            await transaction.rollback(true);
            throw e;
        }
    }

    /** Проход 1: выгружаем каждый день периода в журнал. Ничего не считаем. */
    private async loadPeriod(from: string, to: string): Promise<number> {
        let total = 0;
        for (
            let day = DateTime.fromISO(from);
            day <= DateTime.fromISO(to);
            day = day.plus({ days: 1 })
        ) {
            const date = day.toISODate();
            this.logger.log(`${date}: запрашиваю у Ozon…`);
            const accruals = await this.fetchDay(date);
            this.logger.log(`${date}: получено ${accruals.length}, пишу в журнал…`);
            total += await this.accrualService.saveDay(date, accruals);
            this.logger.log(`${date}: записано ${accruals.length}, всего за период ${total}`);
        }
        return total;
    }

    /** День отдаётся страницами по курсору last_id. Тот же курсор в ответе — конец. */
    private async fetchDay(date: string): Promise<AccrualDto[]> {
        const out: AccrualDto[] = [];
        let lastId = 0;
        for (;;) {
            const page = await this.productService.getAccrualsByDay(date, lastId);
            out.push(...page.accruals);
            if (page.accruals.length) this.logger.log(`  ${date}: страница +${page.accruals.length}, всего ${out.length}`);
            if (!page.accruals.length || !page.last_id || page.last_id === lastId) break;
            lastId = page.last_id;
        }
        return out;
    }

    /**
     * Проход 2: закрываем счета по телам.
     *
     * Счёт ищем ТОЧНЫМ равенством PRIM — на этом держится гейт возвратов: при
     * возврате processReturns дописывает к PRIM пометку, и такой счёт намеренно
     * не находится. Не нашли или не в статусе 4 — не платим и говорим об этом,
     * молча пропускать нельзя.
     */
    private async closeInvoices(
        settlements: { postingNumber: string; amount: number; parts: { accrualId: number; amount: number }[] }[],
        transaction: any,
    ): Promise<{ closed: { count: number; amount: number }; unpaid: AccrualUnpaidDto[]; cancelledIds: number[] }> {
        const unpaid: AccrualUnpaidDto[] = [];
        const cancelledIds: number[] = [];
        if (!settlements.length) return { closed: { count: 0, amount: 0 }, unpaid, cancelledIds };

        this.logger.log(`Ищу счета по ${settlements.length} номерам отправлений`);
        const invoices = await this.invoiceService.getByPostingNumbers(settlements.map((s) => s.postingNumber));
        this.logger.log(`Нашлось счетов: ${invoices.length}`);
        const byRemark = new Map(invoices.map((i) => [i.remark, i]));

        // Счёт не нашёлся — надо понять, отменён он или его нет вовсе: отменённые
        // помечаем в журнале, иначе они всплывают в «не оплачено» каждый прогон.
        const notFound = settlements.filter((s) => !byRemark.has(s.postingNumber)).map((s) => s.postingNumber);
        const states = notFound.length ? await this.invoiceService.getInvoiceStates(notFound) : new Map();

        const commissions = new Map<string, number>();
        const settleEntries = [];
        for (const settlement of settlements) {
            const invoice = byRemark.get(settlement.postingNumber);
            if (!invoice) {
                const cancelled = states.get(settlement.postingNumber)?.cancelled;
                unpaid.push({
                    postingNumber: settlement.postingNumber,
                    amount: settlement.amount,
                    reason: cancelled ? 'возврат: счёт отменён' : 'счёта по номеру нет',
                });
                if (cancelled) cancelledIds.push(...settlement.parts.map((p) => p.accrualId));
                continue;
            }
            if (invoice.status !== INVOICE_READY_STATUS) {
                unpaid.push({
                    postingNumber: settlement.postingNumber,
                    amount: settlement.amount,
                    reason: `счёт в статусе ${invoice.status}, оплату не ставим`,
                });
                continue;
            }
            commissions.set(settlement.postingNumber, settlement.amount);
            settleEntries.push({ scode: invoice.id, parts: settlement.parts });
        }

        this.logger.log(`К закрытию ${commissions.size} счетов, не оплачиваем ${unpaid.length}`);
        if (commissions.size) {
            await this.invoiceService.updateByCommissions(commissions, transaction);
            this.logger.log('Счета закрыты, помечаю журнал');
            await this.accrualService.settle(settleEntries, transaction);
        }
        return {
            closed: {
                count: commissions.size,
                amount: round2([...commissions.values()].reduce((s, v) => s + v, 0)),
            },
            unpaid,
            cancelledIds,
        };
    }

    /**
     * Письмо по итогам прогона тем же каналом, что и остальные уведомления.
     *
     * Шлём ПОСЛЕ коммита: при откате уведомлять не о чем. В письмо идёт то, что
     * требует рук — начисления без привязки к отправлению (реклама, склад,
     * страхование), неоплаченные счета и несошедшийся контроль.
     */
    private sendLetter(report: AccrualWeekReportDto, unattributed: AccrualDto[]): void {
        const lines: string[] = [
            `Период: ${report.period.from} … ${report.period.to}`,
            `Загружено начислений: ${report.loaded}`,
            `Закрыто счетов: ${report.closed.count} на ${report.closed.amount} руб.`,
            `Ждут своего тела: ${report.waiting.count} на ${report.waiting.amount} руб.`,
            `Возвраты и невыкупы: ${report.returns.count} на ${report.returns.amount} руб.`,
        ];

        if (!report.balanced) {
            lines.push('', 'ВНИМАНИЕ: контроль не сошёлся, итогу верить нельзя.');
        }
        if (report.missingDays.length) {
            lines.push('', `Пропущенные дни в журнале: ${report.missingDays.join(', ')}`);
        }
        if (report.late.count) {
            lines.push('', `Опоздали (счёт уже закрыт либо его нет): ${report.late.count} на ${report.late.amount} руб.`);
        }

        if (report.unpaid.length) {
            lines.push('', `Не оплачено, разобраться — ${report.unpaid.length}:`);
            for (const u of report.unpaid) {
                lines.push(`  ${u.postingNumber}  ${u.amount} руб.  ${u.reason}`);
            }
        }

        if (unattributed.length) {
            lines.push('', `Без привязки к отправлению — ${unattributed.length} на ${report.letter.amount} руб.:`);
            for (const a of unattributed) {
                lines.push(`  ${a.date}  ${a.total_amount?.amount} руб.  ${a.accrued_category}`);
            }
        }

        this.eventEmitter.emit(
            'error.message',
            `Начисления Ozon за ${report.period.from} … ${report.period.to}`,
            lines.join('\n'),
        );
        this.logger.log('Письмо по итогам прогона отправлено');
    }

    /** Судьбу ожидающих решает состояние счёта, а не форма начисления. */
    private async classify(pending: AccrualDto[], today: string): Promise<PendingClassification[]> {
        const postingNumbers = [
            ...new Set(pending.map((a) => (a.unit_number || '').trim()).filter((u) => /^\d+-\d+-\d+$/.test(u))),
        ];
        const states = postingNumbers.length ? await this.invoiceService.getInvoiceStates(postingNumbers) : new Map();
        return classifyPending(pending, states, { today });
    }

    /**
     * Контроль: всё, что подняли из журнала, должно найтись в корзинах отчёта.
     * Не сойдётся — значит запись потерялась по дороге, и это повод не верить итогу.
     */
    private isBalanced(unsettled: AccrualDto[], report: AccrualWeekReportDto, unpaid: AccrualUnpaidDto[]): boolean {
        const input = round2(unsettled.reduce((s, a) => s + amountOf(a), 0));
        const output = round2(
            report.closed.amount +
                unpaid.reduce((s, u) => s + u.amount, 0) +
                report.waiting.amount +
                report.late.amount +
                report.returns.amount +
                report.letter.amount,
        );
        if (input !== output) {
            this.logger.error(`Контроль не сошёлся: поднято ${input}, разложено ${output}`);
        }
        return input === output;
    }
}
