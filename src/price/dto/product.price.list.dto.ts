import { ProductPriceDto } from './product.price.dto';

export class ProductPriceListDto {
    items: ProductPriceDto[];
    last_id: string;
    total: number;
}
