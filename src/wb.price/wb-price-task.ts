import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { wbDiscountTo } from '../helpers/price/wb.discount.helper';
import type { WbPriceTask } from './wb.price.service';
/** Единое преобразование цены в формат отправки/сверки ВБ. */
export function wbPriceTask(price: UpdatePriceDto, nmID: string | number): WbPriceTask {
    const base = parseInt(price.old_price);
    const min = Number(price.min_price);
    return {
        nmID: parseInt(String(nmID)),
        price: base,
        discount: wbDiscountTo(base, min > 0 ? min : parseInt(price.price)),
    };
}
