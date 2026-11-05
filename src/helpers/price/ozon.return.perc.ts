import type { IProductCoeffsable } from '../../interfaces/i.product.coeffsable';
import type { IPriceable } from '../../interfaces/i.priceable';

export interface OzonReturnCounts {
    /** Проданные единицы артикула; отмены уже исключены источником данных. */
    soldUnits: number;
    /** Оплаченные клиентские возвраты в тех же единицах, без отмен и невыкупов. */
    paidReturnUnits: number;
}

/**
 * Доля возвратов: 1 = 100%. Отмены повторно не вычитаются из продаж.
 * При отсутствии продаж используем переданный fallback, по умолчанию 0.
 * Выбор категории, чтение env и дедупликация событий остаются у вызывающего кода.
 * Отношение не ограничиваем сверху: функция не скрывает превышение возвратов над продажами.
 */
export function calculateOzonReturnPerc({ soldUnits, paidReturnUnits }: OzonReturnCounts, fallbackPerc = 0): number {
    if (!Number.isSafeInteger(soldUnits) || soldUnits < 0) {
        throw new RangeError('Количество продаж должно быть целым неотрицательным числом');
    }
    if (!Number.isSafeInteger(paidReturnUnits) || paidReturnUnits < 0) {
        throw new RangeError('Количество оплаченных возвратов должно быть целым неотрицательным числом');
    }
    if (!Number.isFinite(fallbackPerc) || fallbackPerc < 0 || fallbackPerc > 1) {
        throw new RangeError('Резервная доля возвратов должна быть от 0 до 1');
    }
    return soldUnits === 0 ? fallbackPerc : paidReturnUnits / soldUnits;
}

/** Общая передача статистики в расчёт: другие площадки не получают расходы Ozon. */
export function ozonReturnPriceFields(
    product: IProductCoeffsable,
    returnPerc: number = 0,
): Pick<IPriceable, 'return_perc' | 'return_flow_amount'> {
    return product.getReturnFlowAmount
        ? { return_perc: returnPerc ?? 0, return_flow_amount: product.getReturnFlowAmount() }
        : {};
}
