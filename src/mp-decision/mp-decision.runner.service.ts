import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebirdTransaction } from 'ts-firebird';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { OZON_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionService } from './mp-decision.service';
import { Decision, DecisionInput, MpScheme } from './mp-decision.types';

/** Что реально сделано по решению — уходит в письмо рядом с самим решением. */
export interface ExecOutcome {
    done: string[];
    failed: string[];
}

/**
 * Прогон решающей таблицы: наблюдение (итерация 5) + исполнение (итерации 7 и 8).
 *
 * Исполнение включается двумя НЕЗАВИСИМЫМИ флагами (по плану «включение —
 * снятие двух флагов», флаг появился вместе с исполнителем):
 *  - `MP_SALE_ACTIONS_ENABLED` (итерация 7) — `retire`: доставлено → 5→6
 *    (`MARKCODE_FBS_SOLD`) + письмо на ручной вывод из оборота с KM_FULL;
 *  - `MP_RETURN_ACTIONS_ENABLED` (итерация 8) — возвраты: `unretire` (6→5,
 *    ДО донора), донор по `ReturnedToOzon`, `return-to-stock` (TT 3→0)
 *    по `ReceivedBySeller`.
 *
 * Отмены исполнитель НЕ трогает никогда: отмены FBS живут отдельным кодом
 * (`order.service.cancelOrder`, включены 10.08), отмены FBO — старым путём.
 * По ним таблица остаётся наблюдением.
 *
 * Слои фиксируются независимо (решение владельца 2026-08-08): упавшее действие
 * над кодом идёт в письмо, но не блокирует ни остальные действия, ни фиксацию
 * события. Настоящий сбой (транзакция не закоммитилась) — наружу, событие
 * останется необработанным в журнале и придёт на ретрай.
 *
 * Дедуп решений держится на журнале MP_EVENT: одно решение на одно СОСТОЯНИЕ
 * отправления или возврата, а не на каждый пятиминутный проход.
 */
@Injectable()
export class MpDecisionRunnerService {
    private readonly logger = new Logger(MpDecisionRunnerService.name);
    /** Решения текущего прогона (и что по ним сделано) — уходят одним письмом в flush(). */
    private pending: { decision: Decision; outcome?: ExecOutcome }[] = [];
    /** Сколько раз сработала каждая ветка с момента старта сервиса. */
    private readonly counters = new Map<string, number>();
    /**
     * Потолок разбора за прогон. Каждое решение — это два чтения по номеру отправления,
     * а `PRIM = ?` идёт NATURAL-планом (индекса на S.PRIM нет): 1772 reads / 0.38 c
     * на запрос. В обычном прогоне новых состояний единицы, но ПЕРВЫЙ прогон после
     * выката поднимает весь накопленный хвост окна — без потолка он молотил бы базу
     * дольше, чем интервал крона.
     */
    private static readonly MAX_PER_RUN = 200;
    private budget = MpDecisionRunnerService.MAX_PER_RUN;
    /** Сколько событий не разобрано из-за потолка — уходит в лог и в письмо, а не молча. */
    private skipped = 0;

    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private mpEvent: MpEventService,
        private decisionService: MpDecisionService,
        private eventEmitter: EventEmitter2,
        private configService: ConfigService,
    ) {}

    /** Итерация 7 включена: исполнять `retire` на доставке. */
    salesEnabled(): boolean {
        return this.configService.get<boolean>('MP_SALE_ACTIONS_ENABLED', false) === true;
    }

    /** Итерация 8 включена: исполнять возвраты (unretire, донор, TT 3→0). */
    returnsEnabled(): boolean {
        return this.configService.get<boolean>('MP_RETURN_ACTIONS_ENABLED', false) === true;
    }

    /**
     * Событие по отправлению (отмена или доставка). Схему передаёт вызывающий —
     * она определяется источником события, а не полем в базе.
     */
    async observePosting(postingNumber: string, scheme: MpScheme, kind: 'cancel' | 'delivered'): Promise<Decision | null> {
        return this.observe(async () => {
            const transferred =
                kind === 'cancel' && scheme === 'FBS'
                    ? // Журнал ведётся с итерации 4: по отправлениям, уехавшим до его появления,
                      // записи о delivering может не быть, и «не передан» окажется ложным.
                      // Наблюдательный крон перечитывает окно 45 дней каждые 5 минут, так что
                      // расхождение живёт до первого прохода после выката.
                      await this.mpEvent.hasAnyState('OZON', 'POSTING_FBS', postingNumber, ['delivering', 'delivered'])
                    : undefined;
            return this.buildInput({ kind, scheme, postingNumber, transferred });
        });
    }

    /**
     * Событие по возврату.
     *
     * @param counts числитель и знаменатель признака частичности, оба со стороны Ozon:
     *        `returnedRows` — сколько ЗАПИСЕЙ возврата у отправления за всю историю
     *        (одна запись = один экземпляр; суммировать `product.quantity` нельзя —
     *        у легаси-записей 2024 г. там количество из строки заказа),
     *        `postingUnits` — сколько единиц в самом отправлении.
     *        Не передан — судить о частичности нечем, и мы не судим: состав нашего
     *        счёта для этого не годится, он в штуках с коэффициентом кратности.
     */
    async observeReturn(
        item: { id: number; posting_number: string; schema?: string; visual?: { status?: { sys_name?: string } } },
        counts?: { returnedRows: number; postingUnits: number },
    ): Promise<Decision | null> {
        return this.observe(async () => {
            const input = await this.buildInput({
                kind: 'return',
                scheme: item.schema === 'Fbo' ? 'FBO' : 'FBS',
                postingNumber: item.posting_number,
                returnState: item.visual?.status?.sys_name ?? 'unknown',
            });
            if (counts && counts.postingUnits > 0) {
                input.partial = counts.returnedRows < counts.postingUnits;
            }
            return input;
        });
    }

    /**
     * Есть ли у решения действия, включённые флагами, — чтобы не открывать
     * транзакцию под решения-наблюдения (их подавляющее большинство).
     */
    needsExecution(decision: Decision): boolean {
        if (decision.input.kind === 'cancel') return false;
        const returnActs =
            this.returnsEnabled() &&
            ((decision.layer1 === 'make-donor' && decision.input.kind === 'return') ||
                decision.layer2.some((c) => c.actions.includes('unretire') || c.actions.includes('return-to-stock')));
        const saleActs = this.salesEnabled() && decision.layer2.some((c) => c.actions.includes('retire'));
        return returnActs || saleActs;
    }

    /**
     * Исполнить включённые флагами действия решения. Порядок жёсткий:
     * сначала `unretire` по всем кодам (6→5 обязан пройти ДО того, как счёт
     * станет донором — иначе код в 6 уедет миграцией), затем слой 1 (донор),
     * затем остальные действия кодов (`retire`, `return-to-stock`).
     *
     * Ошибка ошибке рознь. Гард SP (в тексте есть ANY_EXCEPTION) — осмысленный
     * отказ: ретрай его не изменит, поэтому не блокируем остальные действия,
     * копим в outcome и отдаём в письмо. Всё прочее (сеть, база, lock) — сбой:
     * летит наружу, транзакция откатывается, событие остаётся необработанным
     * и приходит на ретрай следующим прогоном.
     */
    async execute(decision: Decision, transaction: FirebirdTransaction = null): Promise<ExecOutcome> {
        const outcome: ExecOutcome = { done: [], failed: [] };
        const entry = this.pending.find((p) => p.decision === decision);
        if (entry) entry.outcome = outcome;
        // Отмены исполняет cancelOrder — здесь только наблюдение.
        if (decision.input.kind === 'cancel') return outcome;

        const t = transaction ?? (await this.invoiceService.getTransaction());
        try {
            const act = async (label: string, fn: () => Promise<void>): Promise<void> => {
                try {
                    await fn();
                    outcome.done.push(label);
                } catch (e) {
                    // Все гарды процедур кидают именованное исключение ANY_EXCEPTION —
                    // инфраструктурная ошибка этого имени в тексте содержать не может.
                    if (!String(e.message ?? e).includes('ANY_EXCEPTION')) throw e;
                    outcome.failed.push(`${label} — ${e.message}`);
                }
            };
            const ss = this.invoiceService.getStorageSS();

            if (this.returnsEnabled()) {
                for (const code of decision.layer2) {
                    if (code.actions.includes('unretire')) {
                        await act(`unretire ${code.ki}`, () => this.invoiceService.markCodeFbsUnsold(code.ki, t));
                    }
                }
                if (decision.layer1 === 'make-donor') {
                    const posting = decision.input.postingNumber;
                    await act(`донор ${posting}`, () =>
                        this.invoiceService.updatePrim(posting, posting + OZON_ORDER_CANCELLATION_SUFFIX.FBO, t),
                    );
                }
                for (const code of decision.layer2) {
                    if (code.actions.includes('return-to-stock')) {
                        await act(`TT 3->0 ${code.ki}`, () => this.invoiceService.markCodeReturnToStock(code.ki, ss, t));
                    }
                }
            }
            if (this.salesEnabled()) {
                for (const code of decision.layer2) {
                    if (code.actions.includes('retire')) {
                        await act(`retire ${code.ki}`, () => this.invoiceService.markCodeFbsSold(code.ki, t));
                    }
                }
            }
            if (!transaction) await t.commit(true);
            return outcome;
        } catch (e) {
            if (!transaction) await t.rollback(true).catch(() => undefined);
            // Транзакция откачена (нами или владельцем) — «СДЕЛАНО» до сбоя откатилось
            // вместе с ней, письмо не должно рапортовать о несделанном.
            outcome.done = [];
            outcome.failed.push(`сбой исполнения, транзакция откачена, событие уйдёт в ретрай: ${e.message}`);
            throw e;
        }
    }

    /** Одно письмо на прогон вместо письма на событие. Пусто — молчим. */
    flush(cycle: string): void {
        const entries = this.pending;
        const skipped = this.skipped;
        this.pending = [];
        this.skipped = 0;
        this.budget = MpDecisionRunnerService.MAX_PER_RUN;
        if (!entries.length && !skipped) return;

        const loud = entries.filter((e) => this.isLoud(e));
        const executed = entries.filter((e) => e.outcome && (e.outcome.done.length || e.outcome.failed.length)).length;
        this.logger.log(
            `${cycle}: решающая таблица — событий ${entries.length}, исполнено ${executed}, в письмо ${loud.length}` +
                `${skipped ? `, не разобрано по потолку ${skipped}` : ''}; ветки: ${this.countersToString()}`,
        );
        if (!loud.length && !skipped) return;

        this.eventEmitter.emit(
            'error.message',
            `Решающая таблица (${cycle}): ${loud.length}`,
            this.buildLetter(loud, skipped),
        );
    }

    private countersToString(): string {
        const counters = Object.entries(this.getCounters());
        return counters.length ? counters.map(([branch, count]) => `${branch}=${count}`).join(', ') : 'пусто';
    }

    /** Счётчики веток за время работы сервиса — нужны для приёмки итераций 5/7/8. */
    getCounters(): Record<string, number> {
        return Object.fromEntries([...this.counters.entries()].sort((a, b) => b[1] - a[1]));
    }

    private async observe(build: () => Promise<DecisionInput>): Promise<Decision | null> {
        if (this.budget <= 0) {
            this.skipped++;
            return null;
        }
        this.budget--;
        try {
            const decision = this.decisionService.decide(await build());
            this.counters.set(decision.branch, (this.counters.get(decision.branch) ?? 0) + 1);
            this.pending.push({ decision });
            return decision;
        } catch (e) {
            // Наблюдение не имеет права ронять реальную обработку события, в которую
            // оно вклинилось. Исполнение сюда не заходит: у него свой путь ошибок.
            this.logger.error(`решающая таблица — ${e.message}`);
            return null;
        }
    }

    private async buildInput(event: Omit<DecisionInput, 'invoice' | 'codes'>): Promise<DecisionInput> {
        const match = await this.invoiceService.findByPosting(event.postingNumber, null);
        if (!match) return { ...event, invoice: null, codes: [] };
        const codes = await this.invoiceService.getMarkCodesStateByScode(match.invoice.id, null);
        return {
            ...event,
            invoice: {
                id: match.invoice.id,
                number: match.invoice.number ?? null,
                status: match.invoice.status,
                mark: match.mark,
                cancelled: match.cancelled,
                closed: match.closed,
            },
            codes,
        };
    }

    /** В письмо идёт то, что требует внимания: действие (сделанное или бы-сделанное) или письмо-ветка. */
    private isLoud(entry: { decision: Decision; outcome?: ExecOutcome }): boolean {
        const { decision, outcome } = entry;
        return (
            decision.letter ||
            decision.layer1 !== 'none' ||
            decision.layer2.some((code) => code.letter || code.actions.length > 0) ||
            Boolean(outcome && (outcome.done.length || outcome.failed.length))
        );
    }

    private buildLetter(entries: { decision: Decision; outcome?: ExecOutcome }[], skipped: number): string {
        const anyExecuted = entries.some((e) => e.outcome);
        // «ВХОЛОСТУЮ» — только когда действия реально выключены флагами. При включённых
        // флагах и пустом прогоне исполнителя писать «выключены» — враньё (живой случай
        // с магазина 13.08: пять писем-веток, исполнять нечего, шапка соврала).
        const anyFlagOn = this.salesEnabled() || this.returnsEnabled();
        const head = [
            anyExecuted
                ? 'Решающая таблица: строки с пометкой «СДЕЛАНО» исполнены, остальное — наблюдение.'
                : anyFlagOn
                  ? 'Решающая таблица: действия включены, в этом прогоне исполнять было нечего — ниже наблюдение.'
                  : 'Решающая таблица работает ВХОЛОСТУЮ (действия выключены): ниже — что было бы сделано.',
            `Флаги: продажа=${this.salesEnabled() ? 'ВКЛ' : 'выкл'}, возвраты=${this.returnsEnabled() ? 'ВКЛ' : 'выкл'};` +
                ' отмены FBS живут отдельным кодом и исполняются всегда.',
            // Ветки ожидания возврата (cancel-fbs/transferred, cancel-fbo/picked) тихие
            // и видны только счётчиками — без этой строки читатель решит, что бой ждёт,
            // хотя до флага их разбирает старый код.
            ...(this.returnsEnabled()
                ? []
                : [
                      'Возвраты выкл: «ждём запись возврата» (cancel-fbs/transferred, cancel-fbo/picked) — ' +
                          'план таблицы, а НЕ бой: бой сейчас делает донора сразу старым кодом.',
                  ]),
            ...(skipped
                ? [
                      `ВНИМАНИЕ: ${skipped} событий за этот прогон не разобрано — упёрлись в потолок ` +
                          `${MpDecisionRunnerService.MAX_PER_RUN} решений на прогон. Ожидаемо на первом ` +
                          'прогоне после выката (поднимается весь хвост окна), дальше должно быть 0.',
                  ]
                : []),
            '',
        ];
        const body = entries.map((entry) => this.describe(entry));
        const tail = [
            '',
            'Счётчик веток с момента старта сервиса:',
            ...Object.entries(this.getCounters()).map(([branch, count]) => `  ${branch}: ${count}`),
        ];
        return [...head, ...body, ...tail].join('\n');
    }

    private describe(entry: { decision: Decision; outcome?: ExecOutcome }): string {
        const { decision, outcome } = entry;
        const { input } = decision;
        const event = [input.kind, input.scheme, input.returnState].filter(Boolean).join('/');
        const lines = [`${input.postingNumber} — ${event} [${decision.branch}]`];
        lines.push(
            input.invoice
                ? `  счёт №${input.invoice.number ?? '?'} (SCODE ${input.invoice.id}), STATUS=${input.invoice.status}` +
                      `${input.invoice.mark ? `, пометка «${input.invoice.mark.trim()}»` : ''}`
                : '  счёт не найден',
        );
        lines.push(`  слой 1: ${this.layer1Text(decision)} — ${decision.reason}`);
        for (const code of decision.layer2) {
            const state = input.codes.find((c) => c.ki === code.ki);
            const actions = code.actions.length ? code.actions.join(' → ') : code.letter ? 'письмо' : 'ничего';
            lines.push(
                `  код ${code.ki} (TT=${state?.transferType}, STATUS=${state?.status}` +
                    `${state?.retireReason ? `, RETIRE_REASON=${state.retireReason}` : ''}): ${actions} — ${code.note}`,
            );
            if (code.actions.includes('retire') && code.kmFull) lines.push(`    KM_FULL: ${code.kmFull}`);
        }
        if (outcome) {
            if (outcome.done.length) lines.push(`  СДЕЛАНО: ${outcome.done.join('; ')}`);
            if (outcome.failed.length) lines.push(`  НЕ ПРОШЛО (разобрать): ${outcome.failed.join('; ')}`);
            if (!outcome.done.length && !outcome.failed.length) lines.push('  действий по флагам не было');
        }
        return lines.join('\n');
    }

    private layer1Text(decision: Decision): string {
        switch (decision.layer1) {
            case 'make-donor':
                return 'счёт → STATUS=1 + « отмена FBO» (донор)';
            case 'cancel-fbs-unpicked':
                return 'отвязать коды, снять подборку, счёт → STATUS=0 + « отмена»';
            case 'cancel-fbs-picked':
                return 'коды TT 3→0, счёт → STATUS=1 + « отмена», кладовщику письмо на разбор посылки';
            default:
                return decision.letter ? 'ничего, письмо' : 'ничего';
        }
    }
}
