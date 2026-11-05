import { buildOzonReturnSnapshot, ozonReturnKey } from './ozon.return.snapshot';
import { ProductInfoDto } from '../../product/dto/product.info.dto';
import { OzonReturnReport } from './ozon.return.stats';

const product = (sku: string, typeId?: number) => ({ sku, typeId }) as ProductInfoDto;
const report = (...counts: [string, number, number][]): OzonReturnReport => ({
    issues: [],
    rows: counts.map(([offerId, soldUnits, paidReturnUnits]) => ({
        offerId,
        soldUnits,
        paidReturnUnits,
        returnPerc: soldUnits ? paidReturnUnits / soldUnits : 0,
    })),
});

describe('Выбор сохраняемой доли возвратов', () => {
    it('контроль владельца: три продажи и три возврата дают 100%', () => {
        expect(buildOzonReturnSnapshot(report(['123', 3, 3]), [product('123')])).toEqual([
            { goodscode: '123', pieces: 1, returnPerc: 1 },
        ]);
    });
    it('фасовки раздельны, алиасы одной фасовки складываются по количеству', () => {
        expect(
            buildOzonReturnSnapshot(report(['123', 3, 1], ['123-1', 1, 1], ['123-5', 2, 0]), [
                product('123'),
                product('123-1'),
                product('123-5'),
            ]),
        ).toEqual([
            { goodscode: '123', pieces: 1, returnPerc: 0.5 },
            { goodscode: '123', pieces: 5, returnPerc: 0 },
        ]);
    });
    it('без продаж и без истории — 0, даже если тип возвращают часто', () => {
        const result = buildOzonReturnSnapshot(
            report(['123', 10, 5], ['124', 0, 2]),
            [product('123', 10), product('124', 10), product('125', 10)],
            5,
        );
        expect(result.map((r) => r.returnPerc)).toEqual([0.5, 0, 0]);
    });
    it('при малой истории берёт взвешенный процент своего типа, не среднее процентов', () => {
        const result = buildOzonReturnSnapshot(
            report(['123', 2, 1], ['124', 8, 1], ['125', 90, 90]),
            [product('123', 10), product('124', 10), product('125', 11)],
            5,
        );
        expect(result.map((r) => r.returnPerc)).toEqual([0.2, 0.125, 1]);
    });
    it('при точном достижении порога берёт собственный процент', () => {
        expect(buildOzonReturnSnapshot(report(['123', 3, 3]), [product('123')], 3, 0.1)[0].returnPerc).toBe(1);
    });
    it('нет типа, мало продаж типа или нет истории — настройка по умолчанию', () => {
        expect(
            buildOzonReturnSnapshot(
                report(['123', 1, 0], ['124', 2, 1]),
                [product('123'), product('124', 10), product('125')],
                5,
                0.07,
            ).map((r) => r.returnPerc),
        ).toEqual([0.07, 0.07, 0.07]);
    });
    it('исторический артикул вне текущего каталога сохраняется', () => {
        expect(buildOzonReturnSnapshot(report(['123-5', 4, 1]), [])[0]).toEqual({
            goodscode: '123',
            pieces: 5,
            returnPerc: 0.25,
        });
    });
    it.each([0, -1, 1.5, NaN, Infinity])('отклоняет порог %s', (n) => {
        expect(() => buildOzonReturnSnapshot(report(), [], n)).toThrow();
    });
    it.each([-0.1, 1.1, NaN, Infinity])('отклоняет резервную долю %s', (n) => {
        expect(() => buildOzonReturnSnapshot(report(), [], 1, n)).toThrow();
    });
    it.each(['abc', '0', '12-0', '12-1x', '12-1-2', '01', '12-01', '2147483648', '12-2147483648'])(
        'отклоняет артикул %s',
        (sku) => {
            expect(() => ozonReturnKey(sku)).toThrow();
        },
    );
    it('отклоняет неоднозначный отчёт, не подменяя ошибку нулём', () => {
        const data = report(['123', 1, 0]);
        data.issues.push({ posting: 'p', sku: '1', units: null, reason: 'unmapped-sku' });
        expect(() => buildOzonReturnSnapshot(data, [])).toThrow('неоднозначные');
        data.issues = [];
        data.rows[0].returnPerc = null;
        expect(() => buildOzonReturnSnapshot(data, [])).toThrow('неоднозначные');
    });
    it('не обрезает свыше 100%, не принимает расхождение доли и количеств', () => {
        expect(() => buildOzonReturnSnapshot(report(['123', 1, 2]), [])).toThrow();
        const data = report(['123', 3, 1]);
        data.rows[0].returnPerc = 0;
        expect(() => buildOzonReturnSnapshot(data, [])).toThrow();
    });
    it('отклоняет дубли, конфликт типа и переполнение суммы количеств', () => {
        expect(() => buildOzonReturnSnapshot(report(['123', 1, 0], ['123', 1, 0]), [])).toThrow('Повтор');
        expect(() => buildOzonReturnSnapshot(report(), [product('123', 1), product('123-1', 2)])).toThrow(
            'Разные типы',
        );
        expect(() =>
            buildOzonReturnSnapshot(report(['123', Number.MAX_SAFE_INTEGER, 0], ['123-1', 1, 0]), []),
        ).toThrow();
    });
});
