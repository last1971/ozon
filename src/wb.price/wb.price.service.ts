import { setJobActivity } from '../job/job.execution';
import { wbPriceTask } from './wb-price-task';
import { LossPricingService } from '../marketplace-loss/loss-pricing.service';
import { BulkPriceJobService } from '../price/bulk/bulk-price-job.service';
import { priceUpdateQueue, PricingSnapshot } from '../helpers/price/price-update.queue';
import { assertPricingWritesAllowed } from '../helpers/price/pricing-review-mode';
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
import { WbCardWriter } from '../wb.card/wb.card.writer';
import { readColumnByHeader } from '../helpers';
import { chunk, find, first } from 'lodash';
import Excel from 'exceljs';
import { GoodWbDto } from '../good/dto/good.wb.dto';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { IVatUpdateable } from 'src/interfaces/i.vat.updateable';
import { JobProgress } from '../interfaces/i.job.context';
import { WbCurrentPricesService } from './wb.current-prices.service';
import { wbDiscountTo } from '../helpers/price/wb.discount.helper';

/** Задача для ВБ upload/task: nmID + базовая цена + скидка, %. */
export interface WbPriceTask {
    nmID: number;
    price: number;
    discount: number;
}

export type { WbCurrentPrice } from './wb.current-prices.service';

/** Построчный итог массовой ВБ-ручки. */
export interface WbBulkPriceReport {
    total: number;
    toUpdate: number;
    missing: string[];
    skipped: string[];
    errors: string[];
    uploadId: string | null;
    /** true — только отчёт, в ВБ ничего не ушло. */
    dryRun: boolean;
    /** Что меняется (при dryRun — что поменялось бы): скидка была → станет, цена покупателю после. */
    changes: { article: string; from: number; to: number; buyerAfter: number }[];
    /** После новой скидки цена покупателю всё равно ниже минимальной (база «до скидки» ниже минимальной). */
    belowMin: string[];
}

@Injectable()
export class WbPriceService implements IPriceUpdateable, IVatUpdateable {
    private static readonly VAT_CHARACTERISTIC_ID = 15001405;
    /** setMinPrices не трогает карточку, если база «до скидки» во столько раз и больше выше минимальной. */
    static readonly MAX_BASE_TO_MIN = 3;
    readonly priceUpdateKey = 'wb';
    @Inject(BulkPriceJobService) private readonly bulk: BulkPriceJobService;
    private logger = new Logger(WbPriceService.name);
    constructor(
        private configService: ConfigService,
        @Inject(GOOD_SERVICE) private goodService: IGood,
        private api: WbApiService,
        private cardService: WbCardService,
        private cardWriter: WbCardWriter,
        private currentPrices: WbCurrentPricesService,
        private readonly losses: LossPricingService,
    ) {}
    async checkVatForAll(
        expectedVat: number,
        _limit?: number,
    ): Promise<Array<{ offer_id: string; current_vat: number; expected_vat: number }>> {
        const cards = await this.cardService.getAllWbCards();
        const mismatches: Array<{ offer_id: string; current_vat: number; expected_vat: number }> = [];

        for (const card of cards) {
            // Находим характеристику с НДС
            const vatCharacteristic = card.characteristics?.find(
                (char) => char.id === WbPriceService.VAT_CHARACTERISTIC_ID,
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

    /**
     * Записать ставку НДС в характеристику карточек — через общий писатель карточек ВБ
     * (свежая карточка, бэкап «до», очередь). Итог по карточке: { offer } или { offer, error }.
     */
    async updateVat(offerIds: string[], vat: number): Promise<any> {
        const value = [this.numberToVat(vat)];
        return this.cardWriter.write(
            'vat',
            offerIds.map((offer) => ({ offer, edit: (card: WbCardDto) => this.withVat(card, value) })),
        );
    }

    /** Характеристика НДС в копии карточки: заменить значение или добавить характеристику. */
    private withVat(card: WbCardDto, value: string[]): WbCardDto {
        const characteristics = card.characteristics || [];
        const vatChar = characteristics.find((ch) => ch.id === WbPriceService.VAT_CHARACTERISTIC_ID);
        if (vatChar) {
            vatChar.value = value;
        } else {
            characteristics.push({ id: WbPriceService.VAT_CHARACTERISTIC_ID, value });
        }
        return { ...card, characteristics };
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
        const [data, losses] = await Promise.all([this.goodService.getWbData(skus), this.losses.load('WB', skus)]);
        return data.map(
            (wbData) =>
                new WbPriceCoeffsAdapter(
                    wbData,
                    this.configService.get<number>('WB_EXT_PERC', 0),
                    losses.get(wbData.id),
                ),
        );
    }

    // @Cron('0 5 0 * * 0', { name: 'updateWbPrices' })
    startUpdateAllPrices(clientId?: string) {
        return this.bulk.start(
            {
                market: 'wb',
                page: async (cursor) => {
                    const page = await this.cardService.getGoodIds(cursor ? JSON.parse(cursor) : '');
                    return {
                        offers: [...page.goods.keys()],
                        next: page.nextArgs ? JSON.stringify(page.nextArgs) : undefined,
                    };
                },
                update: (offers, context) => this.goodService.repriceForService(this, offers, undefined, context),
            },
            clientId,
        );
    }
    async updateAllPrices() {
        return this.bulk.wait(this.startUpdateAllPrices().id);
    }

    async preparePriceUpdates() {
        const current = await this.currentPrices.getAll();
        return (prices: UpdatePriceDto[]) => this.updatePrices(prices, current);
    }
    async updatePrices(
        updatePrices: UpdatePriceDto[],
        knownCurrent?: Map<string, import('./wb.current-prices.service').WbCurrentPrice>,
    ): Promise<any> {
        assertPricingWritesAllowed();
        const snapshot = priceUpdateQueue.reader(
            'wb',
            updatePrices.map((p) => p.offer_id),
        );
        const current = knownCurrent ?? (await this.currentPrices.getAll());
        const results: any[] = [],
            uploadIds: string[] = [];
        for (const price of updatePrices) {
            try {
                const response = await priceUpdateQueue.run(
                    'wb',
                    async () => {
                        priceUpdateQueue.assertCurrent(snapshot([price.offer_id]));
                        const data = [wbPriceTask(price, this.cardService.getNmID(price.offer_id))];
                        try {
                            await this.saveMinPrices([price]);
                            return await this.pushPriceTasks(data, current);
                        } finally {
                            priceUpdateQueue.changed('wb', [price.offer_id]);
                        }
                    },
                    { priority: 'background' },
                );
                results.push(...response.results.map((row) => ({ ...row, offer_id: price.offer_id })));
                uploadIds.push(...(response.uploadIds ?? []));
            } catch (error) {
                results.push({
                    offer_id: price.offer_id,
                    nmID: this.cardService.getNmID(price.offer_id),
                    status: 'error',
                    message: error.message,
                });
            }
        }
        return {
            error: results.some((r) => r.status === 'error'),
            results,
            uploadIds,
            data: uploadIds.length ? { id: uploadIds.join(', ') } : null,
        };
    }

    /** Общее сохранение пола, в том числе когда округлённая цена/скидка уже стоят в ВБ. */
    async saveMinPrices(prices: UpdatePriceDto[]): Promise<void> {
        const wbs = await this.goodService.getWbData(prices.map((p) => p.offer_id));
        wbs.forEach((wb) => {
            wb.minPrice = find(prices, { offer_id: wb.id }).min_price;
        });
        await Promise.all(wbs.map((wb) => this.goodService.setWbData(wb, null)));
    }

    /**
     * Отправка задачи «цена + скидка» в ВБ (discounts-prices upload/task).
     * Единая точка вызова: используется и updatePrices, и массовыми ручками applyWb.
     */
    private async pushPriceTasks(
        data: WbPriceTask[],
        current?: Map<string, import('./wb.current-prices.service').WbCurrentPrice>,
    ): Promise<any> {
        if (!data.length) return { error: false, results: [], data: null };
        const prices = current ?? (await this.currentPrices.getAll());
        const byId = new Map([...prices.values()].map((p) => [p.nmID, p]));
        const results: { nmID: number; status: 'accepted' | 'unchanged' | 'error'; message?: string }[] = [];
        const pending: WbPriceTask[] = [];
        for (const task of data) {
            if (
                !Number.isSafeInteger(task.nmID) ||
                task.nmID <= 0 ||
                !Number.isFinite(task.price) ||
                task.price <= 0 ||
                !Number.isInteger(task.discount) ||
                task.discount < 0 ||
                task.discount > 100
            ) {
                results.push({
                    nmID: task.nmID,
                    status: 'error',
                    message: 'Нет карточки WB или некорректная цена/скидка',
                });
                continue;
            }
            const actual = byId.get(task.nmID);
            if (actual?.price === task.price && actual?.discount === task.discount)
                results.push({ nmID: task.nmID, status: 'unchanged' });
            else pending.push(task);
        }
        const uploadIds: string[] = [];
        for (const part of chunk(pending, 1000)) {
            setJobActivity('wb', 'Отправка цены в ВБ');
            const response = await this.api.method(
                'https://discounts-prices-api.wildberries.ru/api/v2/upload/task',
                'post',
                { data: part },
                true,
            );
            const status = response?.unchanged
                ? 'unchanged'
                : response?.data?.id && !response?.error
                  ? 'accepted'
                  : 'error';
            const message =
                response?.error?.data?.errorText ||
                response?.errorText ||
                response?.error?.message ||
                'WB не подтвердил приём задачи';
            if (status === 'accepted') uploadIds.push(String(response.data.id));
            results.push(
                ...part.map((task) => ({
                    nmID: task.nmID,
                    status,
                    ...(status === 'error' ? { message: String(message) } : {}),
                })),
            );
        }
        return {
            error: results.some((r) => r.status === 'error'),
            results,
            uploadIds,
            data: uploadIds.length ? { id: uploadIds.join(', ') } : null,
        };
    }

    /**
     * Общее ядро массовых ВБ-ручек. Считает скидку каждому артикулу через calcDiscount
     * и одной задачей отправляет в ВБ. minPrice берётся из Firebird, базовая цена — из кабинета ВБ.
     * calcDiscount: вернуть процент, вернуть null — пропустить, бросить — записать в errors.
     */
    private async applyWb(
        articles: string[] | 'all',
        calcDiscount: (base: number, minPrice: number, currentDiscount: number) => number | null,
        dryRun = false,
        expected?: Map<string, PricingSnapshot>,
    ): Promise<WbBulkPriceReport> {
        const snapshot = priceUpdateQueue.reader('wb');
        const current = await this.currentPrices.getAll();
        if (articles === 'all') articles = [...current.keys()];
        const wbData = await this.goodService.getWbData(articles);
        const minPriceByArt = new Map(wbData.map((w) => [w.id, Number(w.minPrice)]));

        const data: WbPriceTask[] = [];
        const missing: string[] = [];
        const skipped: string[] = [];
        const errors: string[] = [];
        const changes: WbBulkPriceReport['changes'] = [];
        const belowMin: string[] = [];

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
            if (discount === null || discount === cur.discount) {
                skipped.push(article);
                continue;
            }
            data.push({ nmID: cur.nmID, price: cur.price, discount });
            const buyerAfter = Math.round(cur.price * (1 - discount / 100));
            changes.push({ article, from: cur.discount, to: discount, buyerAfter });
            if (minPrice > 0 && buyerAfter < minPrice) belowMin.push(article);
        }

        // ВБ принимает до 1000 товаров в задаче («все» по кабинету — больше)
        const uploadIds: string[] = [];
        if (!dryRun && data.length) {
            for (const task of data) {
                const article = [...current].find(([, p]) => p.nmID === task.nmID)?.[0] ?? String(task.nmID);
                try {
                    const res = await priceUpdateQueue.run(
                        'wb',
                        async () => {
                            priceUpdateQueue.assertCurrent(expected?.get(article) ?? snapshot([article]));
                            try {
                                return await this.pushPriceTasks([task], current);
                            } finally {
                                priceUpdateQueue.changed('wb', [article]);
                            }
                        },
                        { priority: 'background' },
                    );
                    uploadIds.push(...res.uploadIds);
                    for (const row of res.results) {
                        if (row.status === 'error') errors.push(`${article}: ${row.message}`);
                        if (row.status === 'unchanged') skipped.push(article);
                        if (row.status !== 'accepted') {
                            const index = changes.findIndex((c) => c.article === article);
                            if (index >= 0) changes.splice(index, 1);
                        }
                    }
                } catch (error) {
                    errors.push(`${article}: ${error.message}`);
                    const index = changes.findIndex((c) => c.article === article);
                    if (index >= 0) changes.splice(index, 1);
                }
            }
        }
        const uploadId = uploadIds.join(', ') || null;
        return {
            total: articles.length,
            toUpdate: changes.length,
            missing,
            skipped,
            errors,
            uploadId,
            dryRun,
            changes,
            belowMin,
        };
    }

    /**
     * Ручка 1: цена покупателю ВБ = минимальной (min_price из Firebird), в обе стороны — и после акции ВБ,
     * задравшей скидку, и когда цена выше минимальной. Пустой список — все карточки кабинета.
     * Уже стоящие на минимальной пропускаются: ВБ на повтор отвечает 400 «already set». dryRun — только отчёт.
     */
    async setMinPrices(
        articles: string[],
        dryRun = false,
        expected?: Map<string, PricingSnapshot>,
    ): Promise<WbBulkPriceReport> {
        return this.applyWb(
            articles.length ? articles : 'all',
            (base, minPrice, currentDiscount) => {
                if (!(minPrice > 0)) throw new Error('нет min_price в Firebird');
                // База в разы выше минимальной — заглушка «не продавать» (93 000 ₽, 23.10.2026) или неверная
                // минимальная фасовки: не трогаем. Снижение в 3 раза и больше ВБ и сам кладёт в карантин.
                if (base >= minPrice * WbPriceService.MAX_BASE_TO_MIN) {
                    throw new Error(
                        `база ${base} в ${Math.floor(base / minPrice)} раз выше минимальной ${minPrice} — заглушка?`,
                    );
                }
                const discount = wbDiscountTo(base, minPrice);
                return discount === currentDiscount ? null : discount;
            },
            dryRun,
            expected,
        );
    }

    /** Ручка 2: выставить фиксированную скидку percent на список артикулов. */
    async setDiscount(articles: string[], percent: number): Promise<WbBulkPriceReport> {
        return this.applyWb(articles, () => percent);
    }

    /** Ручка 3: то же, но не ниже min_price — берём меньшую из {percent, скидка до min_price}. */
    async setDiscountSafe(articles: string[], percent: number): Promise<WbBulkPriceReport> {
        return this.applyWb(articles, (base, minPrice) => {
            if (!(minPrice > 0)) throw new Error('нет min_price в Firebird');
            const maxSafe = wbDiscountTo(base, minPrice);
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

    /**
     * Предметы и комиссии ВБ (tariffs/commission) → WB_CATEGORIES. Справочник ТН ВЭД предметов
     * (TNVED_LIST/TNVED_AT) не трогает — его ведёт WbDictModule. progress — ход для фоновой задачи.
     * Возвращает, сколько предметов отдал ВБ.
     */
    async updateWbSaleCoeffs(progress?: JobProgress): Promise<number> {
        const data = await this.api.method(
            'https://common-api.wildberries.ru/api/v1/tariffs/commission',
            'get',
            {},
            true,
        );
        const report: WbCardDto[] = data?.report ?? [];
        if (progress) Object.assign(progress, { done: 0, total: report.length });
        for (const card of report) {
            await this.goodService.updateWbCategory(card);
            if (progress) progress.done++;
        }
        return report.length;
    }
}
