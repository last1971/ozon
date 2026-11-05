import { OzonSaleLine } from './ozon.accrual.normalizer';
import { OzonInvoiceQuantityLine, resolveOzonInvoiceQuantity } from './ozon.invoice.quantity';

const target = (): OzonSaleLine => ({ posting: '111-222-1', sku: '101', kind: 'sale', units: null });
const row = (quantity: number, pieces: number | null = null, goodscode = '474561'): OzonInvoiceQuantityLine => ({
    goodscode,
    quantity,
    pieces,
});
const catalog = new Map([
    ['101', '474561'],
    ['102', '474561-5'],
    ['103', 'other'],
]);
const resolve = (lines: OzonInvoiceQuantityLine[], offer = '474561') => {
    const line = target();
    return resolveOzonInvoiceQuantity(line, [line], new Map([['101', offer]]), lines);
};

describe('Количество продажи из существующего счёта', () => {
    it('старый счёт 474561 с QUAN=1 и неизвестной фасовкой даёт 1', () => {
        expect(resolve([row(1)])).toBe(1);
    });
    it('штуки делятся на фасовку: 200 штук — две пачки по 100', () => {
        expect(resolve([row(200, 100)], '474561-100')).toBe(2);
        expect(resolve([row(200)], '474561-100')).toBe(2);
    });
    it('несколько строк той же фасовки суммируются', () => {
        expect(resolve([row(5, 5), row(10, 5)], '474561-5')).toBe(3);
    });
    it('чужой товар и явно чужая фасовка не участвуют', () => {
        expect(resolve([row(1, 1), row(500, 100), row(99, 1, '999999')])).toBe(1);
        expect(resolve([row(500, 100)], '474561-5')).toBeNull();
    });
    it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        'некорректное количество %s не исправляет угадыванием',
        (quantity) => {
            expect(resolve([row(quantity)])).toBeNull();
        },
    );
    it('некратное фасовке количество не округляет', () => {
        expect(resolve([row(11, 5)], '474561-5')).toBeNull();
    });
    it('переполнение суммы не маскируется делением на фасовку', () => {
        expect(resolve([row(Number.MAX_SAFE_INTEGER), row(1)], '474561-2')).toBeNull();
    });
    it.each(['', 'bad', '474561-0', '474561--1', '474561-5x', '474561-999999999999999999999'])(
        'не угадывает фасовку артикула %s',
        (offer) => {
            expect(resolve([row(1)], offer)).toBeNull();
        },
    );
    it('без подходящей строки или артикула сохраняет неизвестное количество', () => {
        expect(resolve([])).toBeNull();
        const line = target();
        expect(resolveOzonInvoiceQuantity(line, [line], new Map(), [row(1)])).toBeNull();
    });
    it('не распределяет счёт между несколькими начислениями одного SKU', () => {
        const line = target();
        expect(resolveOzonInvoiceQuantity(line, [line, { ...line, units: 1 }], catalog, [row(2)])).toBeNull();
    });
    it('не распределяет счёт между разными SKU одной фасовки', () => {
        const line = target();
        expect(
            resolveOzonInvoiceQuantity(
                line,
                [line, { ...line, sku: 'other' }],
                new Map([
                    ['101', '474561'],
                    ['other', '474561-1'],
                ]),
                [row(2)],
            ),
        ).toBeNull();
    });
    it('при двух фасовках берёт только строку с подтверждённой фасовкой', () => {
        const line = target();
        const sales = [line, { ...line, sku: '102', units: 2 }];
        expect(resolveOzonInvoiceQuantity(line, sales, catalog, [row(1, 1), row(10, 5)])).toBe(1);
        expect(resolveOzonInvoiceQuantity(line, sales, catalog, [row(1), row(10, 5)])).toBeNull();
    });
    it('неизвестный товар в том же отправлении запрещает неоднозначное распределение', () => {
        const line = target();
        expect(resolveOzonInvoiceQuantity(line, [line, { ...line, sku: 'missing' }], catalog, [row(1)])).toBeNull();
    });
    it('другой товар или другое отправление не мешают совпадению', () => {
        const line = target();
        const peers = [line, { ...line, sku: '102', posting: 'other' }, { ...line, sku: '999' }];
        expect(
            resolveOzonInvoiceQuantity(line, peers, new Map([...catalog, ['999', '999999']]), [
                row(1),
                row(2, 1, '999999'),
            ]),
        ).toBe(1);
    });
    it('состав продажи не подменяет количество частичного возврата', () => {
        const line = { ...target(), kind: 'refund' as const };
        expect(resolveOzonInvoiceQuantity(line, [line], catalog, [row(100)])).toBeNull();
    });
    it('известное количество сохраняется, входные данные не меняются', () => {
        const line = { ...target(), units: 2 };
        const invoices = [row(100)];
        const before = JSON.stringify([line, invoices]);
        expect(resolveOzonInvoiceQuantity(line, [line], catalog, invoices)).toBe(2);
        expect(JSON.stringify([line, invoices])).toBe(before);
    });
});
