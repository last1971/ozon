import { fboOrigins, priceInBand, weightedOzonLogistics } from './ozon.logistics';
import { LogisticsRow, PriceBand } from '../../ozon.category/tariff.xlsx';
import { RouteBucket } from './ozon.routes';
const low: PriceBand = { min: 0, max: 300, minIncluded: true, maxIncluded: true };
const high: PriceBand = { min: 300, max: null, minIncluded: false, maxIncluded: false };
const rate = (
    amount: number,
    origin = 'Новосибирск',
    destination = 'Москва',
    band = high,
    isDefault = false,
): LogisticsRow => ({
    amount,
    origin,
    destination,
    band,
    isDefault,
    volumeFrom: 0,
    volumeTo: 1,
});
const directions: RouteBucket = {
    scheme: 'fbs',
    scope: 'offer',
    key: '123',
    units: 10,
    destinations: [
        { cluster: 'Москва', units: 8 },
        { cluster: 'Казань', units: 2 },
    ],
};
const origins = [{ cluster: 'Новосибирск', units: 1 }];
const api = { min: 50, max: 200 };
const rows = [
    rate(20, undefined, undefined, low),
    rate(30, undefined, 'Казань', low),
    rate(100),
    rate(150, undefined, 'Казань'),
];
const quote = (r = rows, d = directions, o = origins) => weightedOzonLogistics({ loaded: true, rows: r }, d, o, api);
describe('Взвешенная логистика по тарифным ступеням', () => {
    it('для 8/2 доставок возвращает 22 рубля до 300 и 110 рублей выше 300', () => {
        expect(quote().map((b) => b.amount)).toEqual([22, 110]);
        expect(quote().map((b) => b.source)).toEqual(['tariff', 'tariff']);
    });
    it('300 относится только к нижней ступени; границы берутся из файла', () => {
        expect(priceInBand(300, low)).toBe(true);
        expect(priceInBand(300, high)).toBe(false);
        expect(priceInBand(300.01, high)).toBe(true);
        expect(priceInBand(500, { ...low, max: 500 })).toBe(true);
        expect(priceInBand(NaN, high)).toBe(false);
    });
    it('FBO взвешивает текущие кластеры по доступному остатку', () => {
        const extra = rows.map((r) => ({ ...r, origin: 'Санкт-Петербург', amount: r.amount * 2 }));
        const result = quote([...rows, ...extra], directions, [
            { cluster: 'Новосибирск', units: 3 },
            { cluster: 'Санкт-Петербург', units: 1 },
        ]);
        expect(result[0].amount).toBeCloseTo(27.5, 10);
        expect(result[1].amount).toBeCloseTo(137.5, 10);
    });
    it('нет конкретного маршрута — тариф по умолчанию из того же диапазона', () => {
        const result = quote([rate(100), rate(200, '', '', high, true)]);
        expect(result[0]).toMatchObject({ amount: 120, source: 'tariff-default' });
    });
    it('неизвестное направление сохраняет свой вес с тарифом по умолчанию', () => {
        const d = {
            ...directions,
            destinations: [
                { cluster: 'Москва', units: 8 },
                { cluster: '', units: 2 },
            ],
        };
        expect(quote([rate(100), rate(200, '', '', high, true)], d)[0].amount).toBe(120);
    });
    it('нет истории — среднее min/max API по каждой ступени', () => {
        expect(quote(rows, null).map((b) => [b.amount, b.source])).toEqual([
            [125, 'api-average'],
            [125, 'api-average'],
        ]);
    });
    it('нет таблицы, маршрута или текущего склада — максимум API с причиной', () => {
        expect(weightedOzonLogistics({ loaded: false, rows: [] }, null, origins, api)[0]).toMatchObject({
            amount: 200,
            source: 'api-max',
            warning: expect.any(String),
        });
        expect(quote([rate(100)])[0].source).toBe('api-max');
        expect(quote(rows, null, [])[0].source).toBe('api-max');
    });
    it('ошибка чтения истории не превращается в отсутствие продаж', () => {
        expect(weightedOzonLogistics({ loaded: true, rows }, null, origins, api, 'Ошибка API')[0].source).toBe(
            'api-max',
        );
    });
    it('не округляет результат заранее, нулевой тариф допустим', () => {
        const d = {
            ...directions,
            units: 3,
            destinations: [
                { cluster: 'Москва', units: 1 },
                { cluster: 'Казань', units: 2 },
            ],
        };
        expect(quote([rate(0), rate(1, undefined, 'Казань')], d)[0].amount).toBeCloseTo(2 / 3, 12);
    });
    it('нормализует регистр и пробелы названий, не угадывает другой кластер', () => {
        expect(quote([rate(100, ' НОВОСИБИРСК ', 'москва'), rate(150, undefined, 'Казань')])[0].amount).toBe(110);
    });
    it('отклоняет дубли и некорректные ставки', () => {
        expect(() => quote([rate(100), rate(100), rate(150, undefined, 'Казань')])).toThrow();
        expect(() => quote([rate(-1), rate(150, undefined, 'Казань')])).toThrow();
        expect(() =>
            weightedOzonLogistics({ loaded: false, rows: [] }, null, origins, { min: 50, max: NaN }),
        ).toThrow();
    });
    it('отклоняет пересечение диапазонов и некорректные веса', () => {
        expect(() => quote([...rows, rate(100, undefined, undefined, { ...low, max: 500 })])).toThrow();
        expect(() => quote(rows, { ...directions, units: 9 })).toThrow();
        expect(() => quote(rows, directions, [{ cluster: 'Новосибирск', units: 0 }])).toThrow();
    });
});
describe('Склады FBO', () => {
    const clusters = [
        { name: 'Москва', logistic_clusters: [{ warehouses: [{ warehouse_id: 10 }, { warehouse_id: 11 }] }] },
        { name: 'Казань', logistic_clusters: [{ warehouses: [{ warehouse_id: 20 }] }] },
    ];
    const stock = (warehouse_id: number, present: number, reserved = 0) => ({
        offer_id: '123',
        sku: 100,
        warehouse_id,
        present,
        reserved,
    });
    it('считает доступные остатки, объединяет склады одного кластера и убирает повтор страницы', () => {
        expect(
            fboOrigins('123', [stock(10, 10, 3), stock(11, 3), stock(20, 5), stock(20, 5), stock(30, 0)], clusters),
        ).toEqual([
            { cluster: 'Москва', units: 10 },
            { cluster: 'Казань', units: 5 },
        ]);
    });
    it('не подменяет отсутствующий кластер Новосибирском', () => {
        expect(() => fboOrigins('123', [stock(30, 1)], clusters)).toThrow('Не найден');
    });
    it('полный резерв не участвует', () => {
        expect(fboOrigins('123', [stock(10, 2, 3)], clusters)).toEqual([]);
    });
    it('отклоняет конфликтующие дубли и остатки другого товара', () => {
        expect(() => fboOrigins('123', [stock(10, 1), stock(10, 2)], clusters)).toThrow();
        expect(() => fboOrigins('other', [stock(10, 1)], clusters)).toThrow();
        expect(() => fboOrigins('123', [stock(10, -1)], clusters)).toThrow();
    });
});

describe('FBO: российские и зарубежные склады', () => {
    it('учитывает Минск и Ереван вместе с российским остатком', () => {
        const data = [
            { name: 'Москва', id: 1, units: 3 },
            { name: 'Беларусь', id: 23402539267000, units: 2 },
            { name: 'Армения', id: 1020000407473000, units: 1 },
        ];
        expect(
            fboOrigins(
                '548394-4',
                data.map((d) => ({ offer_id: '548394-4', sku: 10, warehouse_id: d.id, present: d.units, reserved: 0 })),
                data.map((d) => ({ name: d.name, logistic_clusters: [{ warehouses: [{ warehouse_id: d.id }] }] })),
            ),
        ).toEqual(data.map((d) => ({ cluster: d.name, units: d.units })));
    });
});
