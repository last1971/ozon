import { PriceDto } from '../price/dto/price.dto';
import { Buffer } from 'exceljs';

export interface IUnprofitableItem {
    offer_id: string;
    name: string;
    incoming_price: number;
    selling_price: number;
    loss: number;
}

export interface IGoodsProcessingContext {
    skus: string[];
    ozonSkus?: string[];
    ozonPrices?: PriceDto[];
    ozonPricesHighPrice?: PriceDto[];
    unprofitableItems?: IUnprofitableItem[];
    xlsxBuffer?: Buffer;
    resultProcessingMessage?: string;
    logger?: { log: (msg: string) => void };
    priceThreshold?: number;
    filterMaxIncomingPrice?: number;
}