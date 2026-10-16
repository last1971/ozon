/**
 * Единственное место, где «товар подлежит маркировке» превращается в SQL: GOODS_CLASSIF.MARK_REQUIRED = 1.
 * `goodsExpr` — выражение с кодом товара: колонка (`r.GOODSCODE`) или параметр (`?`).
 */
export const markRequiredExists = (goodsExpr: string): string =>
    `EXISTS (SELECT 1 FROM GOODS_CLASSIF gc WHERE gc.GOODSCODE = ${goodsExpr} AND gc.MARK_REQUIRED = 1)`;
