import { GoodServiceEnum } from '../../good/good.service.enum';

export class ProductInfoDto {
    sku: string;
    barCode: string;
    remark: string;
    id: string;
    goodService: GoodServiceEnum;
}
