import { FirebirdTransaction } from 'ts-firebird';
import { GoodDto } from '../../../good/dto/good.dto';
import { GoodServiceEnum } from '../../../good/good.service.enum';
import { ICountUpdateable } from '../../../interfaces/ICountUpdatebale';
import { FreeCodesByNominal } from '../mark-codes.distribution';

/**
 * Контекст одного пересчёта остатков для ОДНОГО сервиса. Создаётся заново на каждый маркет:
 * набор фасовок у них разный, поэтому и числа получаются разные (договорённость 9).
 */
export interface IGoodsCountContext {
    /** Маркет, для которого считаем. */
    serviceKey: GoodServiceEnum;
    /** Его API обновления остатков. */
    service: ICountUpdateable;

    /** Крон-путь: какие товары подгрузить из БД (событийный путь передаёт goods сразу). */
    goodIds?: string[];
    /** Товары с остатком и резервом. */
    goods: GoodDto[];
    /** Крон-путь: что сейчас лежит на маркете — нужно, чтобы пушить только изменения. */
    currentCounts?: Map<string, number>;

    /** Транзакция снимка: живёт только на время чтения из БД. */
    transaction?: FirebirdTransaction;

    /** Коды/фасовки, отключённые на этом сервисе (GOODS_DISABLED). */
    disabled: Set<string>;
    /** Товары, которые считаются по маркировке: MARK_REQUIRED = 1 и есть строки в MARKCODES. */
    markedGoods: Set<string>;
    /** Свободные коды маркируемых товаров: GOODSCODE → (номинал → сколько кодов). */
    freeByGood: Map<string, FreeCodesByNominal>;
    /** Живой резерв по заказам: GOODSCODE → [количество в каждом заказе]. */
    reservedByGood: Map<string, number[]>;

    /** SKU этого сервиса, относящиеся к товару: GOODSCODE → список SKU. */
    filteredSkuMap: Map<string, string[]>;
    /** Результат: SKU → количество для маркета. */
    counts: Map<string, number>;
    /** Сколько SKU реально обновлено на маркете. */
    updated: number;

    stopChain?: boolean;
}
