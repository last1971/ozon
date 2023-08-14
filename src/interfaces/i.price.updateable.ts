import { ObtainCoeffsDto } from '../helpers/obtain.coeffs.dto';
import { IProductCoeffsable } from './i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';

export interface IPriceUpdateable {
    getObtainCoeffs(): ObtainCoeffsDto;
    getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]>;
    updatePrices(updatePrices: UpdatePriceDto[]): Promise<any>;
}
