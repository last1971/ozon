import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { isMarkCodesEnabled } from '../helpers/mark-codes.helper';
import { MpEventService, MpService } from '../mp-event/mp-event.service';
import { Trade2006ChzService } from '../trade2006.chz/trade2006.chz.service';
import { CLAIM_RETURN_STATES, LOST_RETURN_STATES, RETURN_STATE } from './mp-decision.types';

/**
 * Еженедельный отчёт «подвисшие коды» (Этап 5, перенесён в итерацию 5).
 *
 * Подвисший — это код, ушедший маркетплейсу (TT=2 или TT=3) и оставшийся
 * в обороте (STATUS=5) на счёте, который уже не в работе: продажа состоялась,
 * а из оборота код не вывели. Эталонный случай — §3 плана: FBS-заказ отменён
 * после отгрузки, счёт стал донором, код уехал на FBO-продажу и вывести его
 * не может никто. Зеркальный висяк — выведенный код (STATUS=6) на счёте-доноре:
 * продажа состоялась и код вывели, но товар вернулся и уехал новой продажей,
 * а оживить код (unretire) было некому — возврат разбирал старый путь.
 *
 * Почему отчёт нужен раньше остального ручного контура: письма дедуплицируются
 * «одно на состояние», то есть про зависший код система напоминает ровно один
 * раз и больше никогда. Этот отчёт — единственное, что ловит накопленную
 * погрешность, и на него прямо опирается решение Этапа 0.2.
 */
@Injectable()
export class StuckCodesService {
    private readonly logger = new Logger(StuckCodesService.name);
    /** Свежий код на счёте в работе — норма. Висяком считаем то, что лежит дольше. */
    private static readonly MIN_AGE_DAYS = 3;
    /** В письмо больше не влезает по-человечески; сколько осталось — пишем строкой. */
    private static readonly LETTER_LIMIT = 200;

    /**
     * Отменён, а заявки возврата всё нет — столько дней ждём, прежде чем звать руками.
     * Решение владельца 19.08.2026: 10 дней вместо прежних 5. Переопределяется
     * `CANCEL_WAIT_NO_RETURN_DAYS` в .env, но по умолчанию править ничего не надо.
     *
     * Порог стал важнее с суточной сверкой зависших FBO: она подбирает счёт в день
     * отгрузки, поэтому отмена после отгрузки теперь чаще попадает на подобранный счёт
     * и уходит именно в это ожидание.
     */
    private static readonly WAIT_NO_RETURN_DAYS_DEFAULT = 10;
    /** Заявка есть, но склада не достигла — напоминаем, когда едет неприлично долго. */
    private static readonly WAIT_IN_TRANSIT_DAYS = 14;

    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
        private mpEvent: MpEventService,
        private chzDb: Trade2006ChzService,
    ) {}

    @Cron('0 0 8 * * 1', { name: 'weeklyStuckCodes' })
    async report(): Promise<void> {
        // Напоминалка об отменах без возврата работает и на магазине (кодов не требует).
        await this.reportCancelWaits().catch((e) => {
            this.logger.error(`отчёт «отменённые без возврата» не собран — ${e.message}`);
            this.eventEmitter.emit('error.message', 'Отчёт «отменённые без возврата» не собран', e.message);
        });

        // На магазине маркировка выключена, таблицы MARKCODES там нет вовсе.
        if (!isMarkCodesEnabled(this.configService)) return;

        let rows: Awaited<ReturnType<IInvoice['findStuckMarkCodes']>>;
        try {
            rows = await this.invoiceService.findStuckMarkCodes(StuckCodesService.MIN_AGE_DAYS, null);
        } catch (e) {
            this.logger.error(`отчёт «подвисшие коды» не собран — ${e.message}`);
            this.eventEmitter.emit('error.message', 'Отчёт «подвисшие коды» не собран', e.message);
            return;
        }

        // Забытая передача в ЧЗ: выведено у нас, но пачка не подтверждена дольше
        // порога. Тот же pending-запрос, что у вкладки «ЧЗ» — точка правды одна.
        await this.reportUnsentChz().catch((e) => {
            this.logger.error(`отчёт «не передано в ЧЗ» не собран — ${e.message}`);
        });

        this.logger.log(`подвисших кодов: ${rows.length}`);
        if (!rows.length) return;

        const shown = rows.slice(0, StuckCodesService.LETTER_LIMIT);
        const lines = shown.map((row) => {
            const age = row.invoiceDate
                ? Math.floor(-DateTime.fromJSDate(new Date(row.invoiceDate)).diffNow('days').days)
                : null;
            return (
                `${row.ki} — товар ${row.goodscode}, TT=${row.transferType}, STATUS=${row.status}` +
                `, счёт ${row.scode ? `№${row.invoiceNumber ?? '?'} (SCODE ${row.scode})` : 'нет'}` +
                `${row.prim ? ` «${row.prim.trim()}»` : ''}` +
                `${row.invoiceStatus === null ? '' : ` (S.STATUS=${row.invoiceStatus})`}` +
                `${age === null ? '' : `, возраст ${age} дн`}`
            );
        });
        if (rows.length > shown.length) {
            lines.push(`… и ещё ${rows.length - shown.length} кодов — полный список в базе, отчёт обрезан`);
        }

        this.eventEmitter.emit(
            'error.message',
            `Подвисшие коды: ${rows.length}`,
            [
                'Коды, ушедшие маркетплейсу (TT=2/3): оставшиеся в обороте (STATUS=5)',
                'на счетах, которые уже не в работе, и выведенные нашей продажей (STATUS=6)',
                'на счетах-донорах — товар вернулся и уехал заново, код не оживлён.',
                `Старше ${StuckCodesService.MIN_AGE_DAYS} дн.`,
                '',
                ...lines,
            ].join('\n'),
        );
    }

    /**
     * Страховка от забытого клика «Подтвердить» во вкладке «ЧЗ»: коды, ждущие
     * передачи дольше порога, — отдельным письмом раз в неделю. Ежедневную
     * работу делает утренняя напоминалка (ChzService), здесь только хвост.
     */
    private async reportUnsentChz(): Promise<void> {
        const edge = DateTime.now().minus({ days: StuckCodesService.MIN_AGE_DAYS });
        const old = (kind: 'retire' | 'return') =>
            this.chzDb.pending(kind).then((codes) =>
                codes.filter((code) => code.since && DateTime.fromJSDate(new Date(code.since)) < edge),
            );
        const retire = await old('retire');
        const giveBack = await old('return');
        if (!retire.length && !giveBack.length) return;
        this.eventEmitter.emit(
            'error.message',
            `ЧЗ: не передано дольше ${StuckCodesService.MIN_AGE_DAYS} дн — ${retire.length + giveBack.length} КИ`,
            [
                'Коды ждут передачи в ЧЗ дольше порога — похоже, пачка скачана, но не подтверждена,',
                'или выгрузка в ГИС МТ забыта. Админка, вкладка «ЧЗ».',
                '',
                ...(retire.length ? [`Вывести из оборота: ${retire.length} КИ.`] : []),
                ...(giveBack.length ? [`Вернуть в оборот: ${giveBack.length} КИ.`] : []),
            ].join('\n'),
        );
    }

    /**
     * Отменённые после отгрузки заказы, возврат которых не случился (решение
     * владельца 2026-08-11 — отменяет прежний отказ от напоминалки).
     *
     * Источник — отметки CANCEL_WAIT в журнале: их ставит отмена, когда решает
     * «ждём запись возврата». Разобранные закрываем (счёт помечен « отмена FBO»
     * возвратом на склад Ozon, погашен ручным расформированием после приёма,
     * либо товар до нас не доедет — списан/утилизирован/потерян у Ozon).
     * Остальные — в письмо по состоянию возврата: живой заявки нет → проверить
     * в кабинете Ozon; приехал к нам → ждёт расформирования; едет дольше
     * двух недель → завис в пути.
     */
    private async reportCancelWaits(): Promise<void> {
        // ВБ ожиданий не пишет (отказник остаётся на складе ВБ — счёт сразу донор),
        // но сервис в цикле, чтобы хардкода 'OZON' здесь не осталось: появись
        // ожидание у другого маркетплейса — оно не потеряется.
        const services: MpService[] = ['OZON', 'WB'];
        const noReturnDays = this.configService.get<number>(
            'CANCEL_WAIT_NO_RETURN_DAYS',
            StuckCodesService.WAIT_NO_RETURN_DAYS_DEFAULT,
        );
        const lines: string[] = [];
        let total = 0;
        for (const svc of services) {
            const waits = await this.mpEvent.listUnhandled(svc, 'CANCEL_WAIT');
            total += waits.length;
            for (const wait of waits) {
                const posting = wait.posting ?? wait.extId;
                const match = await this.invoiceService.findByPosting(posting, null);
                if (!match) {
                    this.logger.warn(`CANCEL_WAIT ${posting}: счёт не найден — пропускаю`);
                    continue;
                }
                if (match.mark || match.invoice.status === 0) {
                    // Возврат разобрал счёт (донор) либо его расформировали руками — ожидание закрыто.
                    await this.mpEvent.markHandled({ service: svc, kind: 'CANCEL_WAIT', extId: wait.extId, state: 'waiting' });
                    continue;
                }
                const age = Math.floor(-DateTime.fromJSDate(wait.firstSeen).diffNow('days').days);
                const states = await this.mpEvent.listStatesForPosting(svc, 'RETURN', posting);
                if (states.some((s) => LOST_RETURN_STATES.includes(s))) {
                    // Товар до нас не доедет (списан/утилизирован/потерян): письмо об этом
                    // уже уходило веткой return/lost, ждать больше нечего — иначе строка
                    // «завис в пути» про несуществующий товар повторялась бы вечно.
                    await this.mpEvent.markHandled({ service: svc, kind: 'CANCEL_WAIT', extId: wait.extId, state: 'waiting' });
                    continue;
                }
                if (states.includes(RETURN_STATE.RECEIVED_BY_SELLER)) {
                    // Не закрываем: напоминание погаснет само, когда счёт расформируют (STATUS=0).
                    lines.push(`${posting} — возврат ПРИЕХАЛ к нам, счёт ждёт расформирования (отменён ${age} дн назад)`);
                    continue;
                }
                // Заявочные записи (отклонена, деньги вернули без товара) физики не обещают —
                // для ожидания их нет: считаем, что живой заявки возврата не появилось.
                const hasReturn = states.some((s) => !CLAIM_RETURN_STATES.includes(s));
                if (!hasReturn && age >= noReturnDays) {
                    lines.push(
                        `${posting} — отменён ${age} дн назад, живой заявки возврата НЕТ — проверить в кабинете маркетплейса`,
                    );
                } else if (hasReturn && age >= StuckCodesService.WAIT_IN_TRANSIT_DAYS) {
                    lines.push(`${posting} — отменён ${age} дн назад, возврат завис в пути (заявка есть, склада не достигла)`);
                }
            }
        }
        if (!total) return;

        this.logger.log(`отменённых в ожидании возврата: ${total}, в письмо: ${lines.length}`);
        if (!lines.length) return;

        this.eventEmitter.emit(
            'error.message',
            `Отменённые без возврата: ${lines.length}`,
            [
                'Заказы, отменённые после отгрузки, по которым возврат не случился.',
                'Счёт не тронут (ждёт), товар где-то между покупателем и складом.',
                '',
                ...lines,
            ].join('\n'),
        );
    }
}
