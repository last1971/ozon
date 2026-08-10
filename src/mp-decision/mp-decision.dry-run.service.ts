import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionService } from './mp-decision.service';
import { Decision, DecisionInput, MpScheme } from './mp-decision.types';

/**
 * Итерация 5: решающая таблица ВХОЛОСТУЮ.
 *
 * Считает по каждому событию, что следовало бы сделать, и не делает ничего:
 * письмо «пришло такое событие, счёт такой, код в таком состоянии, я бы сделал
 * вот это» плюс счётчик срабатываний по каждой ветке. Исполнителя нет и быть
 * не должно — процедуры БД появляются на итерации 6, включение действий это
 * итерации 7 и 8. Существующее поведение (донор при отмене) при этом работает
 * как работало: сюда оно не заходит.
 *
 * Дедуп писем держится на журнале MP_EVENT: сюда попадают только события,
 * которых в журнале ещё не было (`record()` вернул true), то есть одно письмо
 * на одно СОСТОЯНИЕ отправления или возврата, а не на каждый пятиминутный проход.
 */
@Injectable()
export class MpDecisionDryRunService {
    private readonly logger = new Logger(MpDecisionDryRunService.name);
    /** Решения текущего прогона — уходят одним письмом в flush(). */
    private pending: Decision[] = [];
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
    private budget = MpDecisionDryRunService.MAX_PER_RUN;
    /** Сколько событий не разобрано из-за потолка — уходит в лог и в письмо, а не молча. */
    private skipped = 0;

    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private mpEvent: MpEventService,
        private decisionService: MpDecisionService,
        private eventEmitter: EventEmitter2,
    ) {}

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

    /** Одно письмо на прогон вместо письма на событие. Пусто — молчим. */
    flush(cycle: string): void {
        const decisions = this.pending;
        const skipped = this.skipped;
        this.pending = [];
        this.skipped = 0;
        this.budget = MpDecisionDryRunService.MAX_PER_RUN;
        if (!decisions.length && !skipped) return;

        const loud = decisions.filter((d) => this.isLoud(d));
        this.logger.log(
            `${cycle}: решающая таблица вхолостую — событий ${decisions.length}, в письмо ${loud.length}` +
                `${skipped ? `, не разобрано по потолку ${skipped}` : ''}; ветки: ${this.countersToString()}`,
        );
        if (!loud.length && !skipped) return;

        this.eventEmitter.emit(
            'error.message',
            `Решающая таблица вхолостую (${cycle}): ${loud.length}`,
            this.buildLetter(loud, skipped),
        );
    }

    private countersToString(): string {
        const counters = Object.entries(this.getCounters());
        return counters.length ? counters.map(([branch, count]) => `${branch}=${count}`).join(', ') : 'пусто';
    }

    /** Счётчики веток за время работы сервиса — нужны для приёмки итерации 5. */
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
            this.pending.push(decision);
            return decision;
        } catch (e) {
            // Вхолостую — значит и падать не должно: наблюдение не имеет права
            // ронять реальную обработку события, в которую оно вклинилось.
            this.logger.error(`решающая таблица вхолостую — ${e.message}`);
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
                status: match.invoice.status,
                mark: match.mark,
                cancelled: match.cancelled,
                closed: match.closed,
            },
            codes,
        };
    }

    /** В письмо идёт то, что требует внимания: действие над счётом, действие над кодом или письмо. */
    private isLoud(decision: Decision): boolean {
        return (
            decision.letter ||
            decision.layer1 !== 'none' ||
            decision.layer2.some((code) => code.letter || code.actions.length > 0)
        );
    }

    private buildLetter(decisions: Decision[], skipped: number): string {
        const head = [
            'Решающая таблица работает ВХОЛОСТУЮ (итерация 5): ниже — что было бы сделано.',
            'Ни счета, ни коды не тронуты. Существующее поведение работает как раньше.',
            ...(skipped
                ? [
                      `ВНИМАНИЕ: ${skipped} событий за этот прогон не разобрано — упёрлись в потолок ` +
                          `${MpDecisionDryRunService.MAX_PER_RUN} решений на прогон. Ожидаемо на первом ` +
                          'прогоне после выката (поднимается весь хвост окна), дальше должно быть 0.',
                  ]
                : []),
            '',
        ];
        const body = decisions.map((decision) => this.describe(decision));
        const tail = [
            '',
            'Счётчик веток с момента старта сервиса:',
            ...Object.entries(this.getCounters()).map(([branch, count]) => `  ${branch}: ${count}`),
        ];
        return [...head, ...body, ...tail].join('\n');
    }

    private describe(decision: Decision): string {
        const { input } = decision;
        const event = [input.kind, input.scheme, input.returnState].filter(Boolean).join('/');
        const lines = [`${input.postingNumber} — ${event} [${decision.branch}]`];
        lines.push(
            input.invoice
                ? `  счёт ${input.invoice.id}, STATUS=${input.invoice.status}` +
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
