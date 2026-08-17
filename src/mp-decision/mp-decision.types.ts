/**
 * Типы решающей таблицы (Этап 3 плана FBS-выбытия).
 *
 * Таблица разделена на два НЕЗАВИСИМЫХ слоя:
 *  - слой 1 — действие над СЧЁТОМ, коды не смотрим вовсе;
 *  - слой 2 — действие над КОДАМИ, побочное, только если коды на счёте есть.
 * Слой 2 упал на гарде — слой 1 всё равно считается выполненным.
 */

/** Схема берётся из ИСТОЧНИКА события (ручка отправлений / поле schema у возврата), а не из S.IGK. */
export type MpScheme = 'FBS' | 'FBO';

/** Что за событие пришло. */
export type DecisionEventKind = 'delivered' | 'cancel' | 'return';

/** Состояние счёта в момент события. */
export interface DecisionInvoice {
    id: number;
    /** Номер счёта (S.NS) — люди в Trade ищут по нему, SCODE им ни о чём. */
    number: number | null;
    /** S.STATUS: 3 — создан и не собран, 4 — подобран, 1 — донор/сформирован, 5 — закрыт. */
    status: number;
    /** Пометка после номера в PRIM: ' отмена', ' отмена FBO', ' закрыт'. */
    mark: string;
    cancelled: boolean;
    closed: boolean;
}

/** Состояние кода на счёте. */
export interface DecisionCode {
    ki: string;
    /** MARKCODES.STATUS: 5 — в обороте, 6 — выведен. */
    status: number;
    /** MARKCODES.TRANSFER_TYPE: 0 — у нас, 2 — передан по УПД-2, 3 — ушёл FBS. */
    transferType: number;
    /** RETIRE_REASON=1 — выведен нашей продажей; иное — вывод по другой причине, автоматика не откатывает. */
    retireReason: number | null;
    kmFull: string | null;
    /** Цена строки счёта (с НДС) — вторым столбцом в xlsx-вложении для ГИС МТ. */
    price?: number | null;
}

export interface DecisionInput {
    kind: DecisionEventKind;
    scheme: MpScheme;
    /** Маркетплейс события ('OZON' | 'WB' | 'YANDEX'). Отсутствует — 'OZON' (события до параметризации). */
    service?: import('../mp-event/mp-event.service').MpService;
    postingNumber: string;
    /** sys_name возврата — только для kind='return'. */
    returnState?: string;
    /**
     * Товар передан Ozon: в журнале есть запись о `delivering` и дальше.
     * Признак берётся ТОЛЬКО из статуса отправления, не из FINISH_PICKUP.
     */
    transferred?: boolean;
    /** Возврат частичный: записей возврата меньше, чем единиц в счёте. */
    partial?: boolean;
    invoice: DecisionInvoice | null;
    codes: DecisionCode[];
}

/** Действие слоя 1 над счётом. */
export type Layer1Action =
    /** Ничего не делаем. */
    | 'none'
    /** Счёт → STATUS=1 + ' отмена FBO': отдаём в доноры FBO-пула. */
    | 'make-donor'
    /** Отмена FBS при STATUS=3: отвязать коды, снять подборку, ' отмена' + STATUS=0. */
    | 'cancel-fbs-unpicked'
    /** Отмена FBS при STATUS=4: коды TT 3→0 (привязка остаётся), счёт ' отмена' + STATUS=1, кладовщику письмо на разбор посылки. */
    | 'cancel-fbs-picked';

/** Действие слоя 2 над одним кодом. */
export type Layer2Action =
    /** Ничего (идемпотентность или сознательное «руками»). */
    | 'none'
    /** 5→6, RETIRE_REASON=1 — MARKCODE_FBS_SOLD + письмо на вывод из оборота. */
    | 'retire'
    /** 6→5 — MARKCODE_FBS_UNSOLD, ДО того как счёт станет донором. */
    | 'unretire'
    /** TT 3→0 — MARKCODE_RETURN_TO_STOCK (REALPRICECODE не трогаем). */
    | 'return-to-stock'
    /** Отвязать от строки счёта — MARKCODE_DETACH_FOR_FBS. */
    | 'detach';

export interface CodeDecision {
    ki: string;
    /** Пусто — действий нет; несколько — выполняются по порядку. */
    actions: Layer2Action[];
    /** Состояние вне набора → письмо и ничего не делаем. */
    letter: boolean;
    note: string;
    kmFull?: string | null;
}

export interface Decision {
    /** Ключ строки таблицы — по нему считается счётчик срабатываний за прогон. */
    branch: string;
    layer1: Layer1Action;
    /** Почему именно так — идёт в письмо. */
    reason: string;
    /** Слой 1 требует письма. */
    letter: boolean;
    layer2: CodeDecision[];
    input: DecisionInput;
}

/** Заявочные статусы возврата: физики нет, товар никуда не ехал. */
export const CLAIM_RETURN_STATES = [
    'Cancelled',
    'Rejected',
    'Approved',
    'MoneyReturned',
    'CrmRejected',
    'CancelledDisputeNotOpen',
];

/** Возврат в пути — ничего не делаем, только пишем в журнал. */
export const IN_TRANSIT_RETURN_STATES = ['MovingToOzon', 'WaitingShipment', 'MovingToSeller'];

/** Товар до нас не доедет: списан, потерян, утилизирован. */
export const LOST_RETURN_STATES = ['WriteOff', 'PotentiallyLost', 'Utilized'];
