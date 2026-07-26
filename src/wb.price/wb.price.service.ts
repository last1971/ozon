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
import { readColumnByHeader } from '../helpers';
import { find, first } from 'lodash';
import Excel from 'exceljs';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { IVatUpdateable } from 'src/interfaces/i.vat.updateable';

/** Задача для ВБ upload/task: nmID + базовая цена + скидка, %. */
export interface WbPriceTask {
    nmID: number;
    price: number;
    discount: number;
}

/** Текущее состояние товара в кабинете ВБ — те же поля, что и в задаче отправки. */
export type WbCurrentPrice = WbPriceTask;

/** Построчный итог массовой ВБ-ручки. */
export interface WbBulkPriceReport {
    total: number;
    toUpdate: number;
    missing: string[];
    skipped: string[];
    errors: string[];
    uploadId: string | null;
}

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
    
    async updateVat(offerIds: string[], vat: number): Promise<any> {
        const cards: WbCardDto[] = [];

        for (const offerId of offerIds) {
          const card = await this.cardService.getWbCardAsync(offerId);
          cards.push(card);
        }

        const updatedCards = cards.map(card => {
            const characteristics = card.characteristics || [];
            const vatChar = characteristics.find(ch => ch.id === WbPriceService.VAT_CHARACTERISTIC_ID);

            if (vatChar) {
                vatChar.value = [this.numberToVat(vat)];
            } else {
                characteristics.push({
                    id: WbPriceService.VAT_CHARACTERISTIC_ID,
                    value: [this.numberToVat(vat)]
                });
            }

            return { ...card, characteristics };
        });

        return this.cardService.updateCards(updatedCards);
        
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
        return this.pushPriceTasks(data);
    }

    /**
     * Отправка задачи «цена + скидка» в ВБ (discounts-prices upload/task).
     * Единая точка вызова: используется и updatePrices, и массовыми ручками applyWb.
     */
    private async pushPriceTasks(data: WbPriceTask[]): Promise<any> {
        return this.api.method(
            'https://discounts-prices-api.wildberries.ru/api/v2/upload/task',
            'post',
            { data },
            true,
        );
    }

    /**
     * Текущие цены кабинета из ВБ (discounts-prices list/goods/filter), постранично.
     * Ключ — vendorCode (артикул продавца); значение — nmID, базовая (зачёркнутая) цена и текущая скидка.
     */
    private async getCurrentPrices(): Promise<Map<string, WbCurrentPrice>> {
        const map = new Map<string, WbCurrentPrice>();
        const limit = 1000;
        for (let offset = 0; ; offset += limit) {
            const res = await this.api.method(
                'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter',
                'get',
                { limit, offset },
                true,
            );
            const goods = res?.data?.listGoods ?? [];
            for (const g of goods) {
                map.set(g.vendorCode, {
                    nmID: g.nmID,
                    price: Number(g.sizes?.[0]?.price ?? 0),
                    discount: Number(g.discount ?? 0),
                });
            }
            if (goods.length < limit) break;
        }
        return map;
    }

    /**
     * Общее ядро массовых ВБ-ручек. Считает скидку каждому артикулу через calcDiscount
     * и одной задачей отправляет в ВБ. minPrice берётся из Firebird, базовая цена — из кабинета ВБ.
     * calcDiscount: вернуть процент, вернуть null — пропустить, бросить — записать в errors.
     */
    private async applyWb(
        articles: string[],
        calcDiscount: (base: number, minPrice: number, currentDiscount: number) => number | null,
    ): Promise<WbBulkPriceReport> {
        const wbData = await this.goodService.getWbData(articles);
        const minPriceByArt = new Map(wbData.map((w) => [w.id, Number(w.minPrice)]));
        const current = await this.getCurrentPrices();

        const data: WbPriceTask[] = [];
        const missing: string[] = [];
        const skipped: string[] = [];
        const errors: string[] = [];

        for (const article of articles) {
            const cur = current.get(article);
            if (!cur) {
                missing.push(article);
                continue;
            }
            if (!(cur.price > 0)) {
                errors.push(`${article}: нет базовой цены в кабинете ВБ`);
                continue;
            }
            const minPrice = minPriceByArt.get(article);
            let discount: number | null;
            try {
                discount = calcDiscount(cur.price, minPrice, cur.discount);
            } catch (error: any) {
                errors.push(`${article}: ${error.message}`);
                continue;
            }
            if (discount === null) {
                skipped.push(article);
                continue;
            }
            data.push({ nmID: cur.nmID, price: cur.price, discount });
        }

        let uploadId: string | null = null;
        if (data.length) {
            const res = await this.pushPriceTasks(data);
            uploadId = res?.data?.id ?? null;
        }
        return { total: articles.length, toUpdate: data.length, missing, skipped, errors, uploadId };
    }

    /** Ручка 1: выставить в ВБ цену = минимальной (min_price из Firebird) для списка артикулов. */
    async setMinPrices(articles: string[]): Promise<WbBulkPriceReport> {
        return this.applyWb(articles, (base, minPrice) => {
            if (!(minPrice > 0)) throw new Error('нет min_price в Firebird');
            // floor, а не round: округление вверх дало бы бо́льшую скидку и цену ниже min_price.
            return Math.max(0, Math.floor((1 - minPrice / base) * 100));
        });
    }

    /** Ручка 2: выставить фиксированную скидку percent на список артикулов. */
    async setDiscount(articles: string[], percent: number): Promise<WbBulkPriceReport> {
        return this.applyWb(articles, () => percent);
    }

    /** Ручка 3: то же, но не ниже min_price — берём меньшую из {percent, скидка до min_price}. */
    async setDiscountSafe(articles: string[], percent: number): Promise<WbBulkPriceReport> {
        return this.applyWb(articles, (base, minPrice) => {
            if (!(minPrice > 0)) throw new Error('нет min_price в Firebird');
            const maxSafe = Math.max(0, Math.floor((1 - minPrice / base) * 100));
            return Math.min(percent, maxSafe);
        });
    }

    /** Ручка 4: поднять скидку до percent, если текущая меньше; у кого уже ≥ percent — не трогаем. */
    async setMinDiscount(articles: string[], percent: number): Promise<WbBulkPriceReport> {
        return this.applyWb(articles, (_base, _minPrice, currentDiscount) =>
            currentDiscount >= percent ? null : percent,
        );
    }

    /** Список артикулов из xlsx-файла (столбец «Артикул продавца»/«Артикул»). */
    async articlesFromFile(file: Express.Multer.File): Promise<string[]> {
        const articles = await readColumnByHeader(file.buffer, ['Артикул продавца', 'Артикул']);
        return articles.filter((a) => a !== 'ИТОГО');
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
