import { ProductPriceDto } from './product.price.dto';

export class ProductPriceListDto {
    items: ProductPriceDto[];
    cursor: string;
    total: number;
}
