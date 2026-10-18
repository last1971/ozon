import { GoodPriceDto } from '../../good/dto/good.price.dto';
import { GoodPercentDto } from '../../good/dto/good.percent.dto';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';

/**
 * Уже загруженные данные расчёта цены (себестоимости и наценки по кодам) и подложенные себестоимости по артикулам —
 * чтобы подбор наценки для недостающих артикулов не ходил в базу второй раз и видел ту же себестоимость,
 * что и основной расчёт (ступени «код-N» для Sylius считаются от закупки × N, а не от остатка).
 */
export interface PricesContextDto {
    goods: GoodPriceDto[];
    percents: GoodPercentDto[];
    prices?: Map<string, UpdatePriceDto>;
}
