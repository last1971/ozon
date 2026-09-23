import { FirebirdTransaction } from 'ts-firebird';

/**
 * Контекст поиска ГТД для ОДНОЙ приходной партии.
 *
 * Команда-источник кладёт в candidates СЫРЫЕ номера (свежие первыми) и больше ничего не решает:
 * годен номер или нет — знает только {@link OzonGtdFormat}, а когда остановиться — {@link GtdResolver}.
 */
export interface IGtdContext {
    /** PR_META.ID приходной партии, для которой ищем ГТД. */
    partyId: number;
    /** Товар партии — по нему фолбэк ищет соседние приходы. */
    goodscode: string;
    /** Дата партии: фолбэк берёт приход не позже неё. Пусто → ограничения по дате нет. */
    partyDate: Date | null;
    transaction: FirebirdTransaction;
    /** Сырые кандидаты последней отработавшей команды, свежие первыми. */
    candidates: string[];
}
