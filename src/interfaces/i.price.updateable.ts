import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from './i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import Excel from 'exceljs';

export interface IPriceUpdateable {
    getObtainCoeffs(): ObtainCoeffsDto;
    getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]>;
    updatePrices(updatePrices: UpdatePriceDto[]): Promise<any>;
    updateAllPrices(): Promise<any>;
    createAction(file: Express.Multer.File): Promise<Excel.Buffer>;
}
