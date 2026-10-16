import { FirebirdTransaction } from 'ts-firebird';

/** Строка счёта глазами приёма возврата: сколько в счёте, подобрано, нужно, отгружено по УПД. */
export interface ReturnInvoiceLine {
    realpricecode: number;
    goodscode: string;
    name: string | null;
    /** REALPRICE.QUAN — штук в строке счёта. */
    quantity: number;
    /** REALPRICE.PIECES — штук в юните маркетплейса; null — неизвестна (старые строки). */
    pieces: number | null;
    podbposcode: number | null;
    /** Подобрано на стороне инсталляции (QUANSKLAD или QUANSHOP). */
    picked: number;
    /** Нужно по подборке на стороне инсталляции. */
    need: number;
    /** Отгружено по УПД за вычетом проведённых возвратов по УПД. */
    shipped: number;
}

/** Код маркировки, привязанный к строке счёта. */
export interface ReturnLineCode {
    ki: string;
    quantity: number;
    status: number;
    transferType: number;
    retireReason: number | null;
    /** Вывод уже ушёл в ГИС МТ (CHZ_SENT_AT заполнен). */
    chzSent: boolean;
}

export interface SpisanieDto {
    goodscode: string;
    username: string;
    quan: number;
    prim: string;
    osnSpisId: number;
}

/**
 * Складские операции приёма и списания возврата — узкий интерфейс над Trade2006.
 *
 * Отдельно от IInvoice: тот и так широк, а приёму нужны только эти операции. Каждая —
 * штатная процедура базы (её же зовёт Delphi), своих правил остатка здесь нет.
 * Все методы требуют транзакцию: приём и списание — одна транзакция целиком.
 */
export interface IReturnStock {
    /** Сторона подбора инсталляции: 0 — склад, 1 — магазин. */
    storageSS(): 0 | 1;
    getLines(scode: number, t: FirebirdTransaction): Promise<ReturnInvoiceLine[]>;
    /** Коды на строке счёта. Маркировка выключена (магазин) — всегда пусто. */
    getLineCodes(realpricecode: number, t: FirebirdTransaction): Promise<ReturnLineCode[]>;
    /** На счёте осталось хоть что-то подобранное. */
    hasPicked(scode: number, t: FirebirdTransaction): Promise<boolean>;
    /** UPDATE_PODB: изменить «подобрано» и «нужно» одной строки (отрицательные дельты — расформирование). */
    updatePodb(
        p: {
            goodscode: string;
            deltaQuan: number;
            deltaNeed: number;
            realpricecode: number;
            scode: number;
            username: string;
        },
        t: FirebirdTransaction,
    ): Promise<void>;
    /** MARKCODE_DETACH_FROM_REALPRICE: снять привязку кода к строке, резерв партии по QUANTITY. */
    detachFromRealprice(ki: string, realpricecode: number, t: FirebirdTransaction): Promise<void>;
    /** Количество каждой строки счёта := подобрано. Только при STATUS=0 (иначе запрещает LockEdS). */
    setLineQuantitiesToPicked(scode: number, t: FirebirdTransaction): Promise<void>;
    setInvoiceStatus(scode: number, status: number, t: FirebirdTransaction): Promise<void>;
    /**
     * Маркируемый товар (GOODS_CLASSIF.MARK_REQUIRED=1), у которого есть свободные коды на складе.
     * Списать такой без скана — оставить в обороте коды без товара. Маркировка выключена — false.
     */
    hasFreeMarkCodes(goodscode: string, t: FirebirdTransaction): Promise<boolean>;
    /** Товар подлежит маркировке (GOODS_CLASSIF.MARK_REQUIRED=1). Маркировка выключена — false. */
    isMarkRequired(goodscode: string, t: FirebirdTransaction): Promise<boolean>;
    /**
     * Строка подборки под строку счёта, если её ещё нет (нулевая). UPDATE_PODB умеет и вставить,
     * но расход партии и автостатус счёта вешают триггеры UPDATE — поэтому сперва пустая строка,
     * потом штатное изменение (так же делает PODBPOS_MIGRATE_QTY).
     */
    ensurePodbLine(
        p: { scode: number; goodscode: string; realpricecode: number },
        t: FirebirdTransaction,
    ): Promise<void>;
    /** Остаток на стороне инсталляции, резерв под счета и номера счетов, держащих резерв. */
    stockAndReserve(
        goodscode: string,
        t: FirebirdTransaction,
    ): Promise<{ stock: number; reserved: number; reservedBy: number[] }>;
    /** Номер строки списания заранее (генератор стороны инсталляции) — как Delphi. */
    allocateSpisCode(t: FirebirdTransaction): Promise<number>;
    /** Передать номер списания процедурам через контекст транзакции (SPIS_SKLADCODE / SPIS_SHOPCODE). */
    setSpisContext(spisCode: number, t: FirebirdTransaction): Promise<void>;
    /** MARKCODE_STAMP_FOR_SPIS: проверить код и сразу погасить его списанием (6/2). */
    stampForSpis(ki: string, goodscode: string, spisCode: number, t: FirebirdTransaction): Promise<void>;
    /** SPISANIE_UNIV1 с параметрами, как у Delphi без права «цена в списании». */
    spisanie(p: SpisanieDto, t: FirebirdTransaction): Promise<void>;
    spisDocExists(spisCode: number, t: FirebirdTransaction): Promise<boolean>;
    /** Основания списания (OSN_SPIS) без переносов склад↔магазин. */
    listWriteOffReasons(): Promise<{ id: number; name: string }[]>;
}

export const RETURN_STOCK = 'RETURN_STOCK';
