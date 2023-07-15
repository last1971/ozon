import { GoodsStatsWarehouseDto } from './goods.stats.warehouse.dto';

export class GoodsStatsGoodsDto {
    shopSku: string;
    marketSku: number;
    name: string;
    price: number;
    categoryId: number;
    categoryName: string;
    warehouses: GoodsStatsWarehouseDto[];
}
