import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from './i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import Excel from 'exceljs';

export interface IPriceUpdateable {
    readonly priceUpdateKey?: string;
    startUpdateAllPrices?(clientId?: string): import('../job/job.state.dto').JobStateDto;
    getObtainCoeffs(): ObtainCoeffsDto;
    getProductsWithCoeffs(
        skus: string[],
        onError?: (offerId: string, error: unknown) => void,
    ): Promise<IProductCoeffsable[]>;
    updatePrices(updatePrices: UpdatePriceDto[]): Promise<any>;
    /** Пакетное чтение протокольных данных до поштучной записи (например, текущих цен WB). */
    preparePriceUpdates?(): Promise<(prices: UpdatePriceDto[]) => Promise<any>>;
    updateAllPrices(): Promise<any>;
    createAction(file: Express.Multer.File): Promise<Excel.Buffer>;
}
