import { GoodServiceEnum } from '../good.service.enum';
import { DisabledLevel } from '../../helpers';

/**
 * Контекст цепочки отключения/включения товаров на маркете.
 * disable: resolve → write → pushZero.  enable: resolve → clear → restore.
 */
export interface IDisableGoodsContext {
    /** Маркетплейс. */
    service: GoodServiceEnum;
    /** Входные коды (из тела или xlsx). */
    inputSkus: string[];
    /** good → весь товar (GOODSCODE), sku → точная фасовка. */
    level: DisabledLevel;
    /** Что писать/удалять в GOODS_DISABLED (уже закодировано через encodeDisabled). */
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
