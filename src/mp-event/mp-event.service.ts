import { Inject, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { FirebirdPool, FirebirdTransaction } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';

/** Маркетплейс — часть ключа дедупа и единицы отсчёта окна. */
export type MpService = 'OZON' | 'WB' | 'YANDEX';
/** Вид потока. Окно считается отдельно по каждой паре (SERVICE, KIND). */
export type MpKind = 'POSTING_FBS' | 'POSTING_FBO' | 'RETURN';

export interface MpEventDto {
    service: MpService;
    kind: MpKind;
    /** Идентификатор у маркетплейса: номер отправления или id возврата. */
    extId: string;
    /** Состояние на момент, когда увидели. Часть ключа: смена состояния = новое событие. */
    state: string;
    posting?: string;
    payload?: unknown;
}

/**
 * Журнал событий маркетплейсов (таблица MP_EVENT, скрипт sql/36).
 *
 * Заменяет Redis-дедуп `processed:<кэш>:<сервис>` и даёт две вещи, которых
 * у строки в Redis не было:
 *
 * 1. **Окно от последнего увиденного события.** Начало выборки — `MAX(LAST_SEEN)`
 *    по паре (SERVICE, KIND) минус нахлёст. Простой сервиса дольше нахлёста больше
 *    не теряет события: Ozon второй раз их не покажет, а журнал догоняет себя сам.
 *    Максимум берётся по паре, а не общий: общий двигал бы самый частый крон (FBS,
 *    5 минут), и суточный FBO после простоя не догнал бы ничего.
 *
 * 2. **Состояние в ключе.** Дедуп по (SERVICE, KIND, EXT_ID, STATE), поэтому переход
 *    возврата MovingToOzon → ReturnedToOzon — это НОВОЕ событие. Со старым дедупом
 *    по номеру второе состояние не появлялось никогда.
 *
 * «Обработано» — это `HANDLED_AT IS NOT NULL`, и ставится оно только после успешного
 * выполнения ВСЕХ действий по событию. Упало посередине — следующий проход возьмёт
 * событие снова и доделает. Прежний Redis помечал обработанным и упавшее тоже.
 */
@Injectable()
export class MpEventService {
    private logger = new Logger(MpEventService.name);

    constructor(@Inject(FIREBIRD) private pool: FirebirdPool) {}

    private async withTransaction<T>(t: FirebirdTransaction, fn: (t: FirebirdTransaction) => Promise<T>): Promise<T> {
        if (t) return fn(t);
        const own = await this.pool.getTransaction();
        try {
            const result = await fn(own);
            await own.commit(true);
            return result;
        } catch (e) {
            await own.rollback(true).catch(() => undefined);
            throw e;
        }
    }

    /**
     * Записать, что событие видели. Новое — вставляем, знакомое — двигаем LAST_SEEN
     * (на нём стоит окно следующей выборки).
     *
     * @returns true, если событие новое — то есть его ещё никто не обрабатывал.
     */
    async record(event: MpEventDto, t: FirebirdTransaction = null): Promise<boolean> {
        return this.withTransaction(t, async (transaction) => {
            const key = [event.service, event.kind, event.extId, event.state];
            const existing = await transaction.query(
                'SELECT HANDLED_AT FROM MP_EVENT WHERE SERVICE = ? AND KIND = ? AND EXT_ID = ? AND STATE = ?',
                key,
                false,
            );
            if (existing.length) {
                await transaction.execute(
                    'UPDATE MP_EVENT SET LAST_SEEN = CURRENT_TIMESTAMP, POSTING = ?' +
                        ' WHERE SERVICE = ? AND KIND = ? AND EXT_ID = ? AND STATE = ?',
                    [event.posting ?? null, ...key],
                    false,
                );
                return false;
            }
            await transaction.execute(
                'INSERT INTO MP_EVENT (SERVICE, KIND, EXT_ID, STATE, POSTING, PAYLOAD)' + ' VALUES (?, ?, ?, ?, ?, ?)',
                [...key, event.posting ?? null, event.payload ? JSON.stringify(event.payload) : null],
                false,
            );
            return true;
        });
    }

    /** Событие отработано целиком. До этого момента следующий проход возьмёт его снова. */
    async markHandled(event: MpEventDto, t: FirebirdTransaction = null): Promise<void> {
        await this.withTransaction(t, async (transaction) => {
            await transaction.execute(
                'UPDATE MP_EVENT SET HANDLED_AT = CURRENT_TIMESTAMP' +
                    ' WHERE SERVICE = ? AND KIND = ? AND EXT_ID = ? AND STATE = ? AND HANDLED_AT IS NULL',
                [event.service, event.kind, event.extId, event.state],
                false,
            );
        });
    }

    /** Событие уже отработано? Знакомое, но недоделанное — берём в работу снова. */
    async isHandled(event: MpEventDto, t: FirebirdTransaction = null): Promise<boolean> {
        return this.withTransaction(t, async (transaction) => {
            const rows = await transaction.query(
                'SELECT HANDLED_AT FROM MP_EVENT WHERE SERVICE = ? AND KIND = ? AND EXT_ID = ? AND STATE = ?',
                [event.service, event.kind, event.extId, event.state],
                false,
            );
            return Boolean(rows.length && rows[0].HANDLED_AT);
        });
    }

    /**
     * Начало окна выборки: `MAX(LAST_SEEN)` по паре минус нахлёст.
     *
     * Холодный старт (по паре в журнале пусто) — дефолтное окно: FBS 45 дней,
     * FBO 90 дней, возвраты 2 дня нахлёста; дальше окно сжимается само.
     * Если журнал старше дефолтного окна (сервис стоял долго) — берём журнал,
     * иначе простой съел бы события молча.
     */
    async windowStart(
        service: MpService,
        kind: MpKind,
        defaultDays: number,
        overlapDays: number,
        t: FirebirdTransaction = null,
    ): Promise<Date> {
        const fallback = DateTime.now().minus({ day: defaultDays }).startOf('day');
        return this.withTransaction(t, async (transaction) => {
            const rows = await transaction.query(
                'SELECT MAX(LAST_SEEN) AS LAST_SEEN FROM MP_EVENT WHERE SERVICE = ? AND KIND = ?',
                [service, kind],
                false,
            );
            const lastSeen = rows?.[0]?.LAST_SEEN;
            if (!lastSeen) {
                this.logger.log(`${service}/${kind}: журнал пуст, холодный старт — окно ${defaultDays} дн`);
                return fallback.toJSDate();
            }
            // Журнал — источник истины: если он старше дефолтного окна, значит сервис
            // стоял дольше окна, и брать «сейчас минус N» нельзя — простой съест события.
            return DateTime.fromJSDate(new Date(lastSeen)).minus({ day: overlapDays }).toJSDate();
        });
    }
}
