import { GoodServiceEnum } from '../../good/good.service.enum';

export class SupplyDto {
    id: string;
    remark: string;
    goodService: GoodServiceEnum;
    isMarketplace: boolean;
}