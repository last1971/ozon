import { ProductInfoDto } from '../product/dto/product.info.dto';

export interface IProductable {
    // getProductInfoBySku(sku: string): Promise<ProductInfoDto>;
    infoList(offer_id: string[]): Promise<ProductInfoDto[]>; 
}
