import { Inject, Injectable, Logger } from '@nestjs/common';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { WbPriceCoeffsAdapter } from './wb.price.coeffs.adapter';
import { WbPriceUpdateDto } from './dto/wb.price.update.dto';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbDiscountUpdateDto } from './dto/wb.discount.update.dto';
import { WbCardService } from '../wb.card/wb.card.service';
import { find } from 'lodash';
import Excel from 'exceljs';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class WbPriceService implements IPriceUpdateable {
    private logger = new Logger(WbPriceService.name);
    constructor(
        private configService: ConfigService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private api: WbApiService,
        private cardService: WbCardService,
    ) {}
    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: 0,
            percMil: 0,
            percEkv: this.configService.get<number>('WB_EKV', 0),
            sumObtain: this.configService.get<number>('WB_OBTAIN', 0),
            sumLabel: this.configService.get<number>('SUM_LABEL', 2),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        return (await this.goodService.getWbData(skus)).map((wbData) => new WbPriceCoeffsAdapter(wbData));
    }

    @Cron('0 5 0 * * 0', { name: 'updateWbPrices' })
    async updateAllPrices(level = 0, args = ''): Promise<any> {
        const cards = await this.cardService.getGoodIds(args);
        await this.goodService.updatePriceForService(this, Array.from(cards.goods.keys()));
        if (cards.nextArgs) {
            await this.updateAllPrices(level + 1, cards.nextArgs);
        }
        if (level === 0) {
            this.logger.log('All Wb Prices was updated');
        }
    }

    async updatePrices(updatePrices: UpdatePriceDto[]): Promise<any> {
        const skus = updatePrices.map((updatePrice) => updatePrice.offer_id);
        const wbCards = await this.cardService.getCardsByVendorCodes(skus);
        const prices = updatePrices.map(
            (updatePrice): WbPriceUpdateDto => ({
                nmId: find(wbCards, { vendorCode: updatePrice.offer_id }).nmID,
                price: parseInt(updatePrice.old_price),
            }),
        );
        const discounts = updatePrices.map(
            (updatePrice): WbDiscountUpdateDto => ({
                nm: find(wbCards, { vendorCode: updatePrice.offer_id }).nmID,
                discount: Math.floor((1 - parseInt(updatePrice.price) / parseInt(updatePrice.old_price)) * 100),
            }),
        );
        const wbs = await this.goodService.getWbData(skus);
        wbs.forEach((wb) => {
            wb.minPrice = find(updatePrices, { offer_id: wb.id }).min_price;
        });
        await Promise.all(wbs.map((wb) => this.goodService.setWbData(wb, null)));
        return {
            updatePrices: await this.updateWbPrice(prices),
            updateDiscounts: await this.updateDiscounts(discounts),
        };
    }

    async updateWbPrice(prices: WbPriceUpdateDto[]): Promise<any> {
        return this.api.method('/public/api/v1/prices', 'post', prices);
    }

    async updateDiscounts(discounts: WbDiscountUpdateDto[]): Promise<any> {
        return this.api.method('/public/api/v1/updateDiscounts', 'post', discounts);
    }

    async createAction(file: Express.Multer.File): Promise<any> {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(file.buffer);
        const worksheet = workbook.getWorksheet(2);
        const newWorkbook = new Excel.Workbook();
        const newWorksheet = newWorkbook.addWorksheet(worksheet.name);
        newWorksheet.state = 'visible';
        const ids: string[] = [];
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (rowNumber !== 1) ids.push(row.getCell(4).value as string);
        });
        const discounts: Map<string, number> = new Map(
            (await this.goodService.getWbData(ids)).map((discount) => [discount.id, discount.minPrice]),
        );
        let i = 0;
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (
                rowNumber === 1 ||
                parseInt(row.getCell(11).value as string) >= discounts.get(row.getCell(4).value as string)
            ) {
                newWorksheet.insertRow(i++, row.values);
            }
        });
        return newWorkbook.xlsx.writeBuffer();
    }
}
