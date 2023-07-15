import { GoodsStatsWarehouseStockDto } from './goods.stats.warehouse.stock.dto';

export class GoodsStatsWarehouseDto {
    id: number;
    name: string;
    stocks: GoodsStatsWarehouseStockDto[];
}
