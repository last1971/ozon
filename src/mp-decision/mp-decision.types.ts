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

/**
 * Состояния возврата, по которым принимаются решения, — единственная точка правды.
 * Литералами их не пишут: словарь озоновский, ВБ в него нормализуется
 * (`wbClaimState`), и разъехавшиеся написания разошлись бы молча.
 */
export const RETURN_STATE = {
    /** Товар лёг на склад маркетплейса: оттуда он и уедет FBO-продажей. */
    ARRIVED_AT_MARKETPLACE: 'ReturnedToOzon',
    /** Товар приехал к нам: принимает и расформировывает кладовщик. */
    RECEIVED_BY_SELLER: 'ReceivedBySeller',
} as const;

export type PhysicalReturnState = (typeof RETURN_STATE)[keyof typeof RETURN_STATE];

/** Оба состояния «физика случилась»: товар доехал — к маркетплейсу или к нам. */
export const PHYSICAL_RETURN_STATES: readonly PhysicalReturnState[] = Object.values(RETURN_STATE);

/** Заявочные статусы возврата: физики нет, товар никуда не ехал. */
export const CLAIM_RETURN_STATES = [
    'Cancelled',
    'Rejected',
    'Approved',
    'MoneyReturned',
    'CrmRejected',
    'CancelledDisputeNotOpen',
];

/**
 * Возврат в пути, и едет он К МАРКЕТПЛЕЙСУ: товар осядет на его складе и уедет
 * оттуда FBO-продажей. Действий по этому состоянию нет — пометку счёта меняют
 * только по приезду (`RETURN_STATE.ARRIVED_AT_MARKETPLACE`): пока товара на складе
 * нет, продавать оттуда нечего.
 */
export const TO_MARKETPLACE_TRANSIT_STATES = ['MovingToOzon'];

/**
 * Возврат в пути, и едет он К НАМ: примет и расформирует кладовщик.
 * `ArrivedAtReturnPlace` сюда НЕ входит намеренно — по нему сегодня уходит письмо
 * (ветка `return/unknown-state`), и это единственный сигнал «коробка лежит в пункте
 * возврата, заберите». Заглушить его, не заведя взамен напоминалку, значит потерять
 * невыкупленную коробку молча.
 */
export const TO_SELLER_TRANSIT_STATES = ['MovingToSeller'];

/**
 * Возврат в пути, а направление по ИМЕНИ состояния не определяется вовсе.
 *
 * `WaitingShipment` — самое раннее сообщение (48 отправлений из 97 начинались с него),
 * и выходит он в обе стороны: `47301820-0285-1` → `ПЕРМЬ_РФЦ_ВОЗВРАТЫ` (к Ozon),
 * а `04808040-0413-1` и `24497386-0470-1` (24–25.08.2026) → `ТОМСК_70`, то есть к нам.
 * Направление в таком случае видно только по `place`/`target_place` из ответа
 * маркетплейса. Решений по этому набору принимать нельзя — либо ждать следующего
 * состояния, либо смотреть маршрут.
 */
export const UNKNOWN_DIRECTION_TRANSIT_STATES = ['WaitingShipment'];

/**
 * Любой возврат в пути — ничего не делаем, только пишем в журнал.
 * Состав прежний, но собран из наборов по направлению: сам факт «в пути» и
 * «в какую сторону» — разные вопросы, и смешивать их в одном списке нельзя.
 */
export const IN_TRANSIT_RETURN_STATES = [
    ...TO_MARKETPLACE_TRANSIT_STATES,
    ...UNKNOWN_DIRECTION_TRANSIT_STATES,
    ...TO_SELLER_TRANSIT_STATES,
];

/**
 * Пункт возврата ПРОДАВЦА: коробка доехала до нашего пункта и ждёт, что её заберут.
 * Держится ОТДЕЛЬНО от `RETURN_STATE` намеренно: там только состояния, по которым
 * принимаются решения, и их значения кормят `PHYSICAL_RETURN_STATES` (признак
 * частичности возврата). Расширять тот набор этим состоянием нельзя — поедет
 * подсчёт частичности. В `IN_TRANSIT_RETURN_STATES` его тоже нет: по нему сегодня
 * уходит письмо (`return/unknown-state`), и это единственный сигнал «заберите коробку».
 */
export const AT_SELLER_RETURN_PLACE = 'ArrivedAtReturnPlace';

/** Состояния, означающие «товар у НАС или едет к нам»: по счёту с пометкой « отмена» это норма. */
export const TOWARDS_SELLER_STATES: readonly string[] = [
    ...TO_SELLER_TRANSIT_STATES,
    RETURN_STATE.RECEIVED_BY_SELLER,
    AT_SELLER_RETURN_PLACE,
];

/**
 * Где физически товар по состоянию возврата. ЕДИНСТВЕННОЕ место, где это решается:
 * вызывающий получает готовый ответ и не собирает его сам из наборов состояний.
 *
 *  - `claim`               — заявка, физики нет, товар никуда не ехал;
 *  - `towards-marketplace` — едет на склад маркетплейса, ещё не доехал;
 *  - `at-marketplace`      — лёг на склад маркетплейса, оттуда и продастся;
 *  - `towards-seller`      — едет к нам или уже у нас;
 *  - `lost`                — не доедет ни до кого: списан, утилизирован, потерян;
 *  - `unknown`             — направление по имени состояния не определяется
 *                            (`WaitingShipment` выходит в обе стороны) либо состояние
 *                            вообще незнакомо. Действий по нему принимать нельзя.
 */
export type ReturnWhereabouts =
    | 'claim'
    | 'towards-marketplace'
    | 'at-marketplace'
    | 'towards-seller'
    | 'lost'
    | 'unknown';

export function returnWhereabouts(state: string): ReturnWhereabouts {
    if (CLAIM_RETURN_STATES.includes(state)) return 'claim';
    if (LOST_RETURN_STATES.includes(state)) return 'lost';
    if (state === RETURN_STATE.ARRIVED_AT_MARKETPLACE) return 'at-marketplace';
    if (TOWARDS_SELLER_STATES.includes(state)) return 'towards-seller';
    if (TO_MARKETPLACE_TRANSIT_STATES.includes(state)) return 'towards-marketplace';
    return 'unknown';
}

/** Товар до нас не доедет: списан, потерян, утилизирован. */
export const LOST_RETURN_STATES = ['WriteOff', 'PotentiallyLost', 'Utilized'];
