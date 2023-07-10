import { StockItemDto } from './stock.item.dto';

export class StockDto {
    sku: string;
    warehouseId: number;
    items: StockItemDto[];
}
