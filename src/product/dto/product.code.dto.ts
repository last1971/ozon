import { StockPresentDto } from './stock.present.dto';
import { IOfferIdable } from '../../interfaces/IOfferIdable';

export class ProductCodeDto implements IOfferIdable {
    offer_id: string;
    product_id?: number;
    stocks?: StockPresentDto[];
}

export class ProductCodeStockDto extends ProductCodeDto {
    stock: number;
    warehouse_id?: number;
}

export class ProductCodeUpdateStockDto extends ProductCodeDto {
    updated: boolean;
    errors: string[];
}

export class ProductCodeUpdateStockResultDto {
    result: ProductCodeUpdateStockDto[];
}
