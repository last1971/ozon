import { ProductCodeDto } from './product.code.dto';

export class ProductListDto {
    items: ProductCodeDto[];
    last_id: string;
    total: number;
}
