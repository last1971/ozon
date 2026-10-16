import { FirebirdTransaction } from 'ts-firebird';

/** Строка счёта-донора FORFBO (REALPRICE) вместе с шапкой счёта. */
export interface DonorPiecesLine {
    realpricecode: number;
    goodscode: string;
    /** Штук на строке. */
    quantity: number;
    /** REALPRICE.PIECES; null — фасовка не проставлена. */
    pieces: number | null;
}

/** Живой счёт-донор FORFBO, у которого есть хотя бы одна строка без фасовки. */
export interface DonorPiecesInvoice {
    scode: number;
    invoiceNumber: number;
    prim: string;
    /** Номер поставки Озона из примечания; null — в примечании его нет. */
    supplyNumber: string | null;
    /** Все строки счёта: суммы по товару считаются по всем, пишутся только пустые. */
    lines: DonorPiecesLine[];
}

/** Позиция поставки Озона: артикул с суффиксом фасовки и число упаковок. */
export interface SupplyItem {
    offerId: string;
    units: number;
}

/** Ответ Озона по одной поставке. */
export type SupplyLookup = { kind: 'found'; items: SupplyItem[] } | { kind: 'not_found' } | { kind: 'error'; message: string };

/**
 * Итог по счёту — он же состояние в журнале MP_EVENT:
 * DONE — всё сошлось и записано; DISPUTE — есть строки, которые руками; NOT_FOUND — Озон поставку
 * не знает; NO_NUMBER — в примечании нет номера; OZON_ERROR — Озон не ответил (в журнал не идёт,
 * следующий проход спросит заново).
 */
export type DonorPiecesOutcome = 'DONE' | 'DISPUTE' | 'NOT_FOUND' | 'NO_NUMBER' | 'OZON_ERROR';

export interface DonorPiecesFill {
    realpricecode: number;
    goodscode: string;
    pieces: number;
}

export interface DonorPiecesDispute {
    /** Строка счёта; null — спор по товару целиком (строк несколько). */
    realpricecode: number | null;
    goodscode: string;
    reason: string;
}

export interface DonorPiecesResult {
    invoice: DonorPiecesInvoice;
    outcome: DonorPiecesOutcome;
    fills: DonorPiecesFill[];
    disputes: DonorPiecesDispute[];
    /** OZON_ERROR: текст ошибки Озона. */
    error?: string;
    /** WritePieces: сколько строк реально записано. */
    written?: number;
    /** JournalOutcomes: такого итога по поставке в журнале ещё не было. */
    isNew?: boolean;
}

/** Контекст цепочки «фасовка доноров». */
export interface DonorPiecesContext {
    /** Проверка без записи: только чтение базы и Озона. */
    dry: boolean;
    /** Покупатель Озона в этой базе (OZON_BUYER_ID) — чужие FORFBO-счета не трогаем. */
    buyerId: number;
    /** Транзакция записи; на шагах чтения не нужна. */
    t?: FirebirdTransaction;
    invoices?: DonorPiecesInvoice[];
    /** Номер поставки → ответ Озона. */
    supplies?: Map<string, SupplyLookup>;
    results?: DonorPiecesResult[];
    stopChain?: boolean;
}
