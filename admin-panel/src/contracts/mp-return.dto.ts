/** Зеркало src/mp-return/dto/*.ts на бэке. */
export type MpService = 'OZON' | 'WB' | 'YANDEX';
/** Площадки экрана возвратов: название кладовщику и что сканировать. */
export const RETURN_SERVICES: { value: MpService; title: string; scanHint: string }[] = [
    { value: 'OZON', title: 'Ozon', scanHint: 'Скан этикетки возврата ii…, номер отправления или заказа' },
    { value: 'WB', title: 'ВБ', scanHint: 'Скан стикера возврата ВБ или номер заказа' },
    { value: 'YANDEX', title: 'Яндекс', scanHint: 'Скан этикетки VOZ_… или коробки 6…-1, номер заказа' },
];

export interface ReturnLine {
    service: MpService;
    extId: string;
    posting: string;
    offerId: string;
    productName: string | null;
    units: number;
    reason: string | null;
    isBuyout: boolean;
    isOpened: boolean;
    receivedAt: string | null;
    barcode: string | null;
    schema: string | null;
    stateName: string | null;
}

export interface ReturnCode {
    ki: string;
    quantity: number;
    status: number;
    transferType: number;
    retireReason: number | null;
    chzSent: boolean;
}

export interface ReturnCard {
    line: ReturnLine;
    invoice: { scode: number; number: number | null; date: string | null; status: number; prim: string | null; mark: string; isDonor: boolean } | null;
    invoiceLine: { realpricecode: number; goodscode: string; name: string | null; quantity: number; pieces: number | null; picked: number; need: number; shipped: number } | null;
    codes: ReturnCode[];
    pieces: number;
    quan: number;
    marksRequired: boolean;
    accepted: { decision: 'RETURN' | 'PROBLEM'; username: string | null; createdAt: string; kis: string[]; comment: string | null; spisCode: number | null; spisAt: string | null } | null;
    warnings: string[];
    blockers: string[];
    canAccept: boolean;
    canWriteOff: boolean;
}

export type ReturnRowStatus = 'pending' | 'accepted' | 'written-off' | 'problem' | 'blocked';

export interface ReturnRow {
    line: ReturnLine;
    invoiceNumber: number | null;
    goodsName: string | null;
    quan: number;
    status: ReturnRowStatus;
    blockers: string[];
    warnings: string[];
}

export type ReturnAction = 'return' | 'return-writeoff' | 'problem';
