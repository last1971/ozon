import { Inject, Injectable, Logger } from '@nestjs/common';
import { IPriceUpdateable } from '../interfaces/i.price.updateable';
import { ObtainCoeffsDto } from '../helpers/dto/obtain.coeffs.dto';
import { IProductCoeffsable } from '../interfaces/i.product.coeffsable';
import { UpdatePriceDto } from '../price/dto/update.price.dto';
import { ConfigService } from '@nestjs/config';
import { GOOD_SERVICE, IGood } from '../interfaces/IGood';
import { WbPriceCoeffsAdapter } from './wb.price.coeffs.adapter';
import { WbPriceUpdateDto } from './dto/wb.price.update.dto';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbDiscountUpdateDto } from './dto/wb.discount.update.dto';
import { WbCardService } from '../wb.card/wb.card.service';
import { find, first } from 'lodash';
import Excel from 'exceljs';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { IVatUpdateable } from 'src/interfaces/i.vat.updateable';

@Injectable()
export class WbPriceService implements IPriceUpdateable, IVatUpdateable {
    private static readonly VAT_CHARACTERISTIC_ID = 15001405;
    private logger = new Logger(WbPriceService.name);
    constructor(
        private configService: ConfigService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private api: WbApiService,
        private cardService: WbCardService,
    ) {}
    async checkVatForAll(expectedVat: number, limit?: number): Promise<Array<{ offer_id: string; current_vat: number; expected_vat: number; }>> {
        const cards = await this.cardService.getAllWbCards();
        const mismatches: Array<{ offer_id: string; current_vat: number; expected_vat: number }> = [];

        for (const card of cards) {
            // Находим характеристику с НДС
            const vatCharacteristic = card.characteristics?.find(
                (char) => char.id === WbPriceService.VAT_CHARACTERISTIC_ID
            );

            if (!vatCharacteristic) {
                // Если нет характеристики НДС, считаем что текущий НДС = 0
                if (expectedVat !== 0) {
                    mismatches.push({
                        offer_id: card.vendorCode,
                        current_vat: 0,
                        expected_vat: expectedVat,
                    });
                }
                continue;
            }

            // Преобразуем значение НДС из API в число
            const currentVat = this.vatToNumber(vatCharacteristic.value);

            // Сравниваем с ожидаемым
            if (currentVat !== expectedVat) {
                mismatches.push({
                    offer_id: card.vendorCode,
                    current_vat: currentVat,
                    expected_vat: expectedVat,
                });
            }
        }

        return mismatches;
    }
    updateVat(offerIds: string[], vat: number): Promise<any> {
        throw new Error('Method not implemented.');
    }
    /**
     * Преобразует значение НДС WB (строка) в стандартное число (проценты)
     * WB использует строки: "0", "5", "7", "10", "12", "13", "20", "Без НДС"
     * "Без НДС" -> -1, "10" -> 10, "0" -> 0
     */
    vatToNumber(vat: any): number {
        const vatStr = String(vat).trim();

        // Особый случай для "Без НДС"
        if (vatStr === 'Без НДС') {
            return -1;
        }

        // Преобразуем строку в число
        const vatNum = parseInt(vatStr, 10);
        return isNaN(vatNum) ? 0 : vatNum;
    }

    /**
     * Преобразует число (проценты) в формат НДС для WB (строка)
     * -1 -> "Без НДС", 0 -> "0", 5 -> "5", 10 -> "10", 20 -> "20"
     */
    numberToVat(vat: number): string {
        if (vat === -1) {
            return 'Без НДС';
        }
        return vat.toString();
    }
    getObtainCoeffs(): ObtainCoeffsDto {
        return {
            minMil: 0,
            percMil: 0,
            percEkv: this.configService.get<number>('WB_EKV', 0),
            sumObtain: this.configService.get<number>('WB_OBTAIN', 0),
            sumLabel: this.configService.get<number>('SUM_LABEL', 2),
            taxUnit: this.configService.get<number>('TAX_UNIT', 6),
        };
    }

    async getProductsWithCoeffs(skus: string[]): Promise<IProductCoeffsable[]> {
        return (await this.goodService.getWbData(skus)).map(
            (wbData) => new WbPriceCoeffsAdapter(wbData, this.configService.get<number>('WB_EXT_PERC', 0)),
        );
    }

    // @Cron('0 5 0 * * 0', { name: 'updateWbPrices' })
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
        // const wbCards = await this.cardService.getCardsByVendorCodes(skus);
        const data = updatePrices.map((updatePrice) => {
            const nmID = this.cardService.getNmID(updatePrice.offer_id);
            return {
                nmID: parseInt(nmID),
                // find(wbCards, { vendorCode: updatePrice.offer_id }).nmID,
                price: parseInt(updatePrice.old_price),
                discount: Math.floor((1 - parseInt(updatePrice.price) / parseInt(updatePrice.old_price)) * 100),
            };
        });
        /*
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
        */
        const wbs = await this.goodService.getWbData(skus);
        wbs.forEach((wb) => {
            wb.minPrice = find(updatePrices, { offer_id: wb.id }).min_price;
        });
        await Promise.all(wbs.map((wb) => this.goodService.setWbData(wb, null)));
        /*
        return {
            updatePrices: await this.updateWbPrice(prices),
            updateDiscounts: await this.updateDiscounts(discounts),
        };
         */
        return this.api.method(
            'https://discounts-prices-api.wildberries.ru/api/v2/upload/task',
            'post',
            { data },
            true,
        );
    }

    // Not using remove
    async updateWbPrice(prices: WbPriceUpdateDto[]): Promise<any> {
        return this.api.method('/public/api/v1/prices', 'post', prices);
    }

    // Not using remove
    async updateDiscounts(discounts: WbDiscountUpdateDto[]): Promise<any> {
        return this.api.method('/public/api/v1/updateDiscounts', 'post', discounts);
    }

    async createAction(file: Express.Multer.File): Promise<any> {
        const workbook = new Excel.Workbook();
        await workbook.xlsx.load(file.buffer as any);
        const worksheet: Excel.Worksheet = first(workbook.worksheets);
        const newWorkbook = new Excel.Workbook();
        const newWorksheet = newWorkbook.addWorksheet(worksheet.name);
        newWorksheet.state = 'visible';
        const ids: string[] = [];
        const targetColumns: { [key: string]: number } = {}; // Словарь для хранения имен и индексов столбцов
        const columnNamesToFind = ['Артикул поставщика', 'Плановая цена для акции']; // Замените на нужные имена столбцов
        // Определяем номера столбцов по их именам (из заголовка в первой строке)
        worksheet.getRow(1).eachCell((cell, colNumber) => {
            if (columnNamesToFind.includes(cell.value as string)) {
                targetColumns[cell.value as string] = colNumber;
            }
        });
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (rowNumber !== 1) ids.push(row.getCell(targetColumns['Артикул поставщика']).value as string);
        });
        const discounts: Map<string, number> = new Map(
            (await this.goodService.getWbData(ids)).map((discount) => [discount.id, discount.minPrice]),
        );
        let i = 1;
        worksheet.eachRow((row: Excel.Row, rowNumber) => {
            if (
                rowNumber === 1 ||
                parseInt(row.getCell(targetColumns['Плановая цена для акции']).value as string) >=
                    discounts.get(row.getCell(targetColumns['Артикул поставщика']).value as string)
            ) {
                newWorksheet.insertRow(i++, row.values);
            }
        });
        return newWorkbook.xlsx.writeBuffer();
    }

    // @Timeout(0)
    async initialWbCategories(): Promise<void> {
        const cards = await this.cardService.getAllWbCards();
        const wbDatas = await this.goodService.getWbData(cards.map((card) => card.vendorCode));
        for (const card of cards) {
            await this.goodService.updateWbCategory(card);
            const wbData: GoodWbDto = find(wbDatas, { id: card.vendorCode }) || { commission: 23, tariff: 50 };
            await this.goodService.setWbData(
                {
                    id: card.vendorCode,
                    commission: wbData.commission,
                    tariff: wbData.tariff,
                    wbCategoriesId: card.subjectID,
                },
                null,
            );
        }
        this.logger.log('Wb categories init');
    }

    async updateWbSaleCoeffs(): Promise<any> {
        const data = await this.api.method(
            'https://common-api.wildberries.ru/api/v1/tariffs/commission',
            'get',
            {},
            true,
        );
        for (const card of data.report) {
            await this.goodService.updateWbCategory(card as WbCardDto);
        }
    }
}
