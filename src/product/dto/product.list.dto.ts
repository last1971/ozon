import { ProductCodeDto } from './product.code.dto';

export class ProductListDto {
    items: ProductCodeDto[];
    cursor: string;
    total: number;
}
