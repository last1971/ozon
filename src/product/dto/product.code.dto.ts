import { StockPresentDto } from './stock.present.dto';

export class ProductCodeDto {
    offer_id: string;
    product_id: number;
    stocks?: StockPresentDto[];
}

export class ProductCodeStockDto extends ProductCodeDto {
    stock: number;
}

export class ProductCodeUpdateStockDto extends ProductCodeDto {
    updated: boolean;
    errors: string[];
}

export class ProductCodeUpdateStockResultDto {
    result: ProductCodeUpdateStockDto[];
}
