export enum GoodsStatsWarehouseStockType {
    AVAILABLE = 'AVAILABLE',
    DEFECT = 'DEFECT',
    FIT = 'FIT',
    FREEZE = 'FREEZE',
    QUARANTINE = 'QUARANTINE',
    UTILIZATION = 'UTILIZATION',
    SUGGEST = 'SUGGEST',
    TRANSIT = 'TRANSIT',
}
export class GoodsStatsWarehouseStockDto {
    type: GoodsStatsWarehouseStockType;
    count: number;
}
