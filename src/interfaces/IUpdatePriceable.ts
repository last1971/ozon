import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { GoodsWithPercents } from '../good/goods.with.percents';

export interface IUpdatePriceable {
    make(goodsWithPercents: GoodsWithPercents): UpdatePriceDto;
}
