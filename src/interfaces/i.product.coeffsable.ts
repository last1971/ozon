export interface IProductCoeffsable {
    getSku(): string;
    getSalesPercent(): number;
    getTransMaxAmount(): number;
    /** Только площадки с учётом возвратов; отсутствие тарифа не означает бесплатный возврат. */
    getReturnFlowAmount?(): number | undefined;
}
