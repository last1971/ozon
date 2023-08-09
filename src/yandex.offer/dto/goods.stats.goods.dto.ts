import { GoodsStatsWarehouseDto } from './goods.stats.warehouse.dto';
import { GoodsStatsWeightDimensionsDto } from './goods.stats.weight.dimensions.dto';
import { GoodsStatsTariffDto } from './goods.stats.tariff.dto';

export class GoodsStatsGoodsDto {
    shopSku: string;
    marketSku: number;
    name: string;
    price: number;
    categoryId: number;
    categoryName: string;
    warehouses: GoodsStatsWarehouseDto[];
    weightDimensions: GoodsStatsWeightDimensionsDto;
    tariffs: GoodsStatsTariffDto[];
}
