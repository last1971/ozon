import { GoodServiceEnum } from '../good.service.enum';

/**
 * Контекст цепочки отключения/включения товаров на маркете.
 * disable: resolve → write → pushZero.  enable: resolve → clear → restore.
 */
export interface IDisableGoodsContext {
    /** Маркетплейс. */
    service: GoodServiceEnum;
    /** Входные SKU (из тела или xlsx). */
    inputSkus: string[];
    /** true → точная фасовка (SKU), false → весь товар (GOODSCODE). */
    exact: boolean;
    /** Что писать/удалять в GOODS_DISABLED (goodCode или sku). */
    tokens?: string[];
    /** Какие SKU реально пушить в маркет (0 при disable, реальный склад при enable). */
    affectedSkus?: string[];
    /** Сколько SKU обновлено. */
    count?: number;
    /** Остановить цепочку (пустой ввод / ошибка). */
    stopChain?: boolean;
    /** Накопленные ошибки. */
    errors?: string[];
}
