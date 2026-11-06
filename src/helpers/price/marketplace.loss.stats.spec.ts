import { lossPeriod, RecordedWriteOff } from './marketplace.loss.stats';
import { WbLossAccumulator } from '../../wb.order/returns/wb-loss-history.source';

const period = { from: '2026-08-08', to: '2026-11-06' };
const sale = (saleID = 'S1', supplierArticle = '123-1', overrides = {}) => ({
    saleID,
    supplierArticle,
    srid: saleID.slice(1),
    date: '2026-10-20T12:00:00',
    lastChangeDate: '2026-10-21T13:00:00',
    ...overrides,
});
const writeOff = (overrides = {}): RecordedWriteOff => ({
    id: 1,
    service: 'WB',
    goodscode: '123',
    units: 1,
    pieces: 1,
    quan: 1,
    spisCode: 10,
    spisSs: 1,
    spisAt: new Date('2026-10-25T10:00:00+03:00'),
    documentQuantity: 1,
    ...overrides,
});

describe('90 дней возвратов и списаний ВБ', () => {
    it('окно московских суток: ровно 90 завершённых дней, включая високосный год', () => {
        expect(lossPeriod(new Date('2026-11-05T21:00:00Z'))).toEqual(period);
        expect(lossPeriod(new Date('2026-11-05T20:59:59Z'))).toEqual({ from: '2026-08-07', to: '2026-11-05' });
        expect(lossPeriod(new Date('2024-03-01T12:00:00Z'))).toEqual({ from: '2023-12-02', to: '2024-03-01' });
        expect(() => lossPeriod(new Date('bad'))).toThrow();
    });
    it('пример владельца: 3 продажи и 3 оплаченных возврата = 100%; продажи не уменьшаются', () => {
        const stats = new WbLossAccumulator(period);
        for (let n = 1; n <= 3; n++) {
            stats.addSale(sale('S' + n));
            stats.addSale(sale('R' + n));
        }
        expect(stats.result()[0]).toMatchObject({ soldUnits: 3, returnedUnits: 3, returnRate: 1, defectRate: 0 });
    });
    it('100 продаж, 10 возвратов, 2 списания: 10% и 2%, без повторного умножения', () => {
        const stats = new WbLossAccumulator(period);
        for (let n = 0; n < 100; n++) stats.addSale(sale('S' + n));
        for (let n = 0; n < 10; n++) stats.addSale(sale('R' + n));
        stats.addWriteOff(writeOff());
        stats.addWriteOff(writeOff({ id: 2, spisCode: 11 }));
        expect(stats.result()[0]).toMatchObject({ returnRate: 0.1, defectRate: 0.02, writtenOffUnits: 2 });
    });
    it('пачки раздельны; 10 штук в пачке — одна продажа/списание; алиасы 123 и 123-1 объединяются', () => {
        const stats = new WbLossAccumulator(period);
        stats.addSale(sale('S1', '123'));
        stats.addSale(sale('S2', '123-1'));
        stats.addSale(sale('S3', '123-10'));
        stats.addWriteOff(writeOff({ pieces: 10, quan: 10, documentQuantity: 10 }));
        expect(stats.result()).toEqual([
            expect.objectContaining({ offerId: '123', soldUnits: 2, writtenOffUnits: 0 }),
            expect.objectContaining({ offerId: '123-10', soldUnits: 1, writtenOffUnits: 1, defectRate: 1 }),
        ]);
    });
    it('дубли страниц и отметок не удваивают количество; продажа и возврат одного srid оба учитываются', () => {
        const stats = new WbLossAccumulator(period);
        stats.addSale(sale());
        stats.addSale(sale());
        stats.addSale(sale('R1'));
        stats.addWriteOff(writeOff());
        stats.addWriteOff(writeOff());
        expect(stats.result()[0]).toMatchObject({ soldUnits: 1, returnedUnits: 1, writtenOffUnits: 1 });
    });
    it('берёт последнюю версию по lastChangeDate, не порядок страниц', () => {
        const stats = new WbLossAccumulator(period);
        stats.addSale(sale('S1', '123', { lastChangeDate: '2026-10-23T00:00:00' }));
        stats.addSale(sale('S1', '456'));
        expect(stats.result()[0]).toMatchObject({ offerId: '123', soldUnits: 1 });
    });
    it('конфликтующие операции одной версии не становятся достоверным процентом', () => {
        const stats = new WbLossAccumulator(period);
        stats.addSale(sale());
        expect(() => stats.addSale(sale('S1', '456'))).toThrow('Неоднозначная');
    });
    it('фильтрует по дате продажи/возврата, не по дате обновления; текущий день исключён', () => {
        const stats = new WbLossAccumulator(period);
        for (const [id, date] of [
            ['S1', '2026-08-08T00:00:00'],
            ['S2', '2026-08-07T23:59:59'],
            ['R1', '2026-11-06T00:00:00'],
            ['R2', '2026-11-05T23:59:59'],
        ])
            stats.addSale(sale(id, '123', { date }));
        stats.addWriteOff(writeOff({ spisAt: new Date('2026-11-06T00:00:00+03:00') }));
        stats.addWriteOff(writeOff({ spisAt: new Date('2026-08-07T23:59:59+03:00') }));
        expect(stats.result()[0]).toMatchObject({ soldUnits: 1, returnedUnits: 1, writtenOffUnits: 0 });
    });
    it('новая версия операции за пределами периода удаляет прежний вклад', () => {
        const stats = new WbLossAccumulator(period);
        stats.addSale(sale());
        stats.addSale(sale('S1', '123', { date: '2026-11-06T09:00:00', lastChangeDate: '2026-11-06T10:00:00' }));
        expect(stats.result()).toEqual([]);
    });
    it('без продаж — null, в том числе при возвратах и списаниях, без NaN/Infinity', () => {
        const stats = new WbLossAccumulator(period);
        stats.addSale(sale('R1'));
        stats.addWriteOff(writeOff());
        expect(stats.result()[0]).toMatchObject({
            returnRate: null,
            defectRate: null,
            warnings: [expect.stringContaining('Нет продаж')],
        });
    });
    it('потери выше продаж не обрезает и явно предупреждает', () => {
        const stats = new WbLossAccumulator(period);
        stats.addSale(sale());
        stats.addSale(sale('R1'));
        stats.addSale(sale('R2'));
        stats.addWriteOff(writeOff({ units: 2, quan: 2, documentQuantity: 2 }));
        expect(stats.result()[0]).toMatchObject({
            returnRate: 2,
            defectRate: 2,
            warnings: [expect.stringContaining('превышают')],
        });
    });
    it.each([
        { saleID: 'C1' },
        { date: 'bad' },
        { supplierArticle: '123-0' },
        { supplierArticle: '123-5x' },
        { srid: '' },
        { lastChangeDate: null },
        { saleID: null },
    ])('отклоняет неверную строку %j', (override) => {
        expect(() => new WbLossAccumulator(period).addSale(sale('S1', '123', override))).toThrow();
    });
    it.each([
        { documentQuantity: null },
        { documentQuantity: 2 },
        { quan: 0 },
        { pieces: 0 },
        { units: 0.5 },
        { service: 'OZON' },
        { spisSs: 2 },
        { spisAt: new Date('bad') },
        { pieces: 10, quan: 1 },
        { goodscode: 'bad' },
    ])('отклоняет неподтверждённое списание %j', (override) => {
        expect(() => new WbLossAccumulator(period).addWriteOff(writeOff(override))).toThrow();
    });
    it('один документ нельзя учесть через две отметки; склады имеют разные генераторы', () => {
        const stats = new WbLossAccumulator(period);
        stats.addWriteOff(writeOff());
        expect(() => stats.addWriteOff(writeOff({ id: 2 }))).toThrow('Повтор документа');
        stats.addWriteOff(writeOff({ id: 3, spisSs: 0 }));
        expect(stats.result()[0].writtenOffUnits).toBe(2);
    });
    it('дубли одной отметки с разными количествами не скрываются', () => {
        const stats = new WbLossAccumulator(period);
        stats.addWriteOff(writeOff());
        expect(() => stats.addWriteOff(writeOff({ units: 2, quan: 2, documentQuantity: 2 }))).toThrow('Неоднозначное');
    });
});
