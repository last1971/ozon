import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebirdTransaction } from 'ts-firebird';
import { writeRows } from '../helpers/spreadsheet.util';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { OZON_ORDER_CANCELLATION_SUFFIX } from '../helpers/order.cancellation.constants';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionService } from './mp-decision.service';
import { Decision, DecisionInput, MpScheme } from './mp-decision.types';

/** Строка xlsx-вложения для ГИС МТ: КИ + цена строки счёта. */
export interface KiRow {
    ki: string;
    price: number | null;
}

/** Что реально сделано по решению — уходит в письмо рядом с самим решением. */
export interface ExecOutcome {
    done: string[];
    failed: string[];
    /** Коды, выведенные из оборота этим решением, — для вложения «вывод». */
    retired: KiRow[];
    /** Коды, возвращённые в оборот, — для вложения «возврат». */
    unretired: KiRow[];
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
     *
     * @param shipped признак «уехал к Ozon» из данных самого отправления
     *        (`isShippedToOzon`) — тот же, которым пользуется бой. Журнал один
     *        этого не знает: он ведётся с 13.08, и по посылкам, отгруженным
     *        раньше, записи о delivering нет — наблюдение писало «собрано и лежит
     *        у нас» про посылки, месяц как уехавшие (живые случаи с магазина:
     *        0111131991-0169-1, 97684792-0208-1). Журнал остаётся страховкой,
     *        когда у вызывающего отправления на руках нет.
     */
    async observePosting(
        postingNumber: string,
        scheme: MpScheme,
        kind: 'cancel' | 'delivered',
        shipped?: boolean,
    ): Promise<Decision | null> {
        return this.observe(async () => {
            const transferred =
                kind === 'cancel' && scheme === 'FBS'
                    ? shipped === true ||
                      (await this.mpEvent.hasAnyState('OZON', 'POSTING_FBS', postingNumber, ['delivering', 'delivered']))
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
        const outcome: ExecOutcome = { done: [], failed: [], retired: [], unretired: [] };
        const kiRow = (ki: string): KiRow => ({
            ki,
            price: decision.input.codes.find((c) => c.ki === ki)?.price ?? null,
        });
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
                        await act(`возврат в оборот ${code.ki}`, async () => {
                            await this.invoiceService.markCodeFbsUnsold(code.ki, t);
                            outcome.unretired.push(kiRow(code.ki));
                        });
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
                        await act(`снятие с отгрузки ${code.ki}`, () => this.invoiceService.markCodeReturnToStock(code.ki, ss, t));
                    }
                }
            }
            if (this.salesEnabled()) {
                for (const code of decision.layer2) {
                    if (code.actions.includes('retire')) {
                        await act(`вывод из оборота ${code.ki}`, async () => {
                            await this.invoiceService.markCodeFbsSold(code.ki, t);
                            outcome.retired.push(kiRow(code.ki));
                        });
                    }
                }
            }
            if (!transaction) await t.commit(true);
            return outcome;
        } catch (e) {
            if (!transaction) await t.rollback(true).catch(() => undefined);
            // Транзакция откачена (нами или владельцем) — «СДЕЛАНО» до сбоя откатилось
            // вместе с ней, письмо не должно ни рапортовать о несделанном,
            // ни класть откаченные коды во вложения.
            outcome.done = [];
            outcome.retired = [];
            outcome.unretired = [];
            outcome.failed.push(`сбой исполнения, транзакция откачена, событие уйдёт в ретрай: ${e.message}`);
            throw e;
        }
    }

    /** Одно письмо на прогон вместо письма на событие. Пусто — молчим. */
    async flush(cycle: string): Promise<void> {
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
            await this.buildAttachments(entries),
        );
    }

    /**
     * xlsx-вложения для ГИС МТ: «вывод из оборота» и «возврат в оборот» отдельными
     * файлами. Формат выверен живыми загрузками 14.08: один КИ (38 символов, без
     * крипто-хвоста и GS) на строку, БЕЗ строки заголовка — заголовок ГИС МТ
     * принимает за код; вторым столбцом цена строки счёта, «1234.00» с точкой.
     * Кладём только то, что реально сделано (откат чистит retired/unretired).
     */
    private async buildAttachments(
        entries: { decision: Decision; outcome?: ExecOutcome }[],
    ): Promise<{ filename: string; content: Buffer }[]> {
        const retired = entries.flatMap((e) => e.outcome?.retired ?? []);
        const unretired = entries.flatMap((e) => e.outcome?.unretired ?? []);
        const attachments: { filename: string; content: Buffer }[] = [];
        if (retired.length) {
            attachments.push({ filename: 'вывод_из_оборота.xlsx', content: await this.buildKiXlsx(retired) });
        }
        if (unretired.length) {
            attachments.push({ filename: 'возврат_в_оборот.xlsx', content: await this.buildKiXlsx(unretired) });
        }
        return attachments;
    }

    private buildKiXlsx(rows: KiRow[]): Promise<Buffer> {
        // Цена строкой, а не числом: ГИС МТ ждёт «1234.00», Excel-число он бы показал как 1234.
        return writeRows(rows.map((row) => [row.ki, row.price === null ? '' : row.price.toFixed(2)]));
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
                      'Возвраты выкл: строки «ждём запись возврата» — план таблицы, ' +
                          'а НЕ бой: бой сейчас делает донора сразу старым кодом.',
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
            ...Object.entries(this.getCounters()).map(([branch, count]) => `  ${count} — ${this.branchRu(branch)}`),
        ];
        return [...head, ...body, ...tail].join('\n');
    }

    /**
     * Русские названия веток — для строк письма и счётчика. Слаг ветки живёт
     * в коде, тестах и логах; читателю письма он не показывается (просьба
     * владельца 14.08: письмо было нечитаемым). Неизвестный слаг печатается как есть.
     */
    private static readonly BRANCH_RU: Record<string, string> = {
        'invoice-not-found': 'счёт не найден',
        'delivered/normal': 'доставлен покупателю',
        'delivered/marked-invoice': 'доставлен, но счёт был отдан в доноры',
        'cancel/closed-invoice': 'отмена по закрытому счёту',
        'cancel/already-marked': 'повторная отмена — счёт уже помечен',
        'cancel-fbo/picked': 'отмена FBO собранного — ждём запись возврата',
        'cancel-fbo/unpicked': 'отмена FBO несобранного — счёт в доноры',
        'cancel-fbo/status-unexpected': 'отмена FBO — счёт в неожиданном состоянии',
        'cancel-fbs/transferred': 'отмена FBS отгруженного — ждём запись возврата',
        'cancel-fbs/picked': 'отмена FBS собранного — разбор посылки кладовщиком',
        'cancel-fbs/in-pick': 'отмена FBS до сборки — автоматика разобрала сама',
        'cancel-fbs/status-unexpected': 'отмена FBS — счёт в неожиданном состоянии',
        'return/claim-state': 'заявка на возврат (товар пока не поехал)',
        'return/in-transit': 'возврат в пути',
        'return/lost': 'возврат не доедет (списан или потерян у Ozon)',
        'return/partial': 'частичный возврат',
        'return/returned-to-ozon': 'возврат лёг на склад Ozon — счёт в доноры',
        'return/returned-to-ozon/already-donor': 'возврат лёг на склад Ozon — счёт уже донор',
        'return/returned-to-ozon/closed-invoice': 'возврат на склад Ozon по закрытому счёту',
        'return/received-by-seller': 'возврат приехал к нам',
        'return/received-by-seller/already-received': 'возврат приехал к нам — счёт уже расформирован',
        'return/unknown-state': 'возврат в неизвестном статусе',
    };

    /** Статус счёта словами — семантика S.STATUS из Trade2006. */
    private static readonly S_STATUS_RU: Record<number, string> = {
        0: 'расформирован',
        1: 'сформирован, не в работе',
        2: 'резерв',
        3: 'создан, ещё не собран',
        4: 'собран',
        5: 'закрыт',
    };

    private branchRu(branch: string): string {
        return MpDecisionRunnerService.BRANCH_RU[branch] ?? branch;
    }

    private describe(entry: { decision: Decision; outcome?: ExecOutcome }): string {
        const { decision, outcome } = entry;
        const { input } = decision;
        const lines = [`${input.postingNumber} — ${this.branchRu(decision.branch)}`];
        if (input.invoice) {
            const status = MpDecisionRunnerService.S_STATUS_RU[input.invoice.status] ?? `STATUS=${input.invoice.status}`;
            lines.push(
                `  счёт №${input.invoice.number ?? input.invoice.id} — ${status}` +
                    `${input.invoice.mark ? `, пометка «${input.invoice.mark.trim()}»` : ''}`,
            );
        }
        lines.push(`  ${decision.reason}`);
        for (const code of decision.layer2) {
            lines.push(`  код ${code.ki}: ${code.note}`);
            if (code.actions.includes('retire') && code.kmFull) lines.push(`    KM_FULL: ${code.kmFull}`);
        }
        if (outcome) {
            if (outcome.done.length) lines.push(`  СДЕЛАНО: ${outcome.done.join('; ')}`);
            if (outcome.failed.length) lines.push(`  НЕ ПРОШЛО (разобрать): ${outcome.failed.join('; ')}`);
            if (!outcome.done.length && !outcome.failed.length) lines.push('  действий по флагам не было');
        }
        return lines.join('\n');
    }
}
