import {
    buildArrivalsList,
    buildDealsList,
    buildHitsList,
    buildNewList,
    dealDiscount,
    parseSupplierCodes,
    SHOWCASE_LIMIT,
    showcaseSince,
} from './showcase.lists';

describe('списки витрин Sylius', () => {
    const stock = (...codes: string[]) => new Set(codes);
    const d = (s: string) => new Date(`${s}T10:00:00`);

    it('showcaseSince — полночь, 90 дней назад', () => {
        const since = showcaseSince(new Date('2026-10-20T15:30:00'));
        expect(since.getDate()).toBe(22);
        expect(since.getMonth()).toBe(6); // июль
        expect([since.getHours(), since.getMinutes()]).toEqual([0, 0]);
    });

    describe('new', () => {
        const since = d('2026-07-22');
        it('свежие первыми, при равенстве даты — больший код; без остатка и старше окна — мимо', () => {
            const list = buildNewList(
                [
                    { code: '564306', firstIn: d('2026-10-06') },
                    { code: '551973', firstIn: d('2026-10-14') },
                    { code: '9', firstIn: d('2026-10-06') },
                    { code: '100', firstIn: d('2026-10-15') }, // нет в магазине
                    { code: '200', firstIn: d('2026-07-01') }, // старше окна
                ],
                stock('564306', '551973', '9', '200'),
                since,
            );
            expect(list).toEqual(['551973', '564306', '9']);
        });
        it('лимит и без повторов', () => {
            const arrivals = Array.from({ length: 250 }, (_, i) => ({ code: String(i), firstIn: d('2026-10-01') }));
            const list = buildNewList([...arrivals, arrivals[0]], new Set(arrivals.map((a) => a.code)), since);
            expect(list).toHaveLength(SHOWCASE_LIMIT);
            expect(new Set(list).size).toBe(SHOWCASE_LIMIT);
        });
    });

    describe('arrivals', () => {
        it('по последнему приходу, свежие первыми; без остатка и старше окна — мимо', () => {
            const list = buildArrivalsList(
                [
                    { code: '562093', lastIn: d('2026-10-19') },
                    { code: '562822', lastIn: d('2026-10-19') }, // та же дата — больший код раньше
                    { code: '562745', lastIn: d('2026-09-22') },
                    { code: '1', lastIn: d('2026-10-20') }, // нет в магазине
                    { code: '2', lastIn: d('2026-09-01') }, // старше окна
                ],
                stock('562093', '562822', '562745', '2'),
                d('2026-09-20'),
            );
            expect(list).toEqual(['562822', '562093', '562745']);
        });
    });

    it('parseSupplierCodes: пробелы и пустые куски — ок, нецифры — ошибка', () => {
        expect(parseSupplierCodes(' 1079, 1246,,2713 ')).toEqual([1079, 1246, 2713]);
        expect(parseSupplierCodes('')).toEqual([]);
        expect(() => parseSupplierCodes('1079,ПП')).toThrow('ПП');
    });

    describe('hits', () => {
        it('розница и счета складываются; порядок — документы, потом штуки; меньше 2 продаж — мимо', () => {
            const list = buildHitsList(
                [
                    { code: '476318', sales: 600, pieces: 3000 }, // розница
                    { code: '476318', sales: 433, pieces: 2368 }, // счета
                    { code: '561526', sales: 711, pieces: 753 },
                    { code: '328525', sales: 655, pieces: 3270 },
                    { code: '492908', sales: 655, pieces: 3971 }, // те же продажи, больше штук — выше
                    { code: '1', sales: 1, pieces: 500 }, // одна продажа — не хит, хоть и сотни штук
                    { code: '2', sales: 900, pieces: 900 }, // нет в магазине
                ],
                stock('476318', '561526', '328525', '492908', '1'),
            );
            expect(list).toEqual(['476318', '561526', '492908', '328525']);
        });
        it('порог 2 включительно; лимит', () => {
            expect(buildHitsList([{ code: '5', sales: 2, pieces: 2 }], stock('5'))).toEqual(['5']);
            const rows = Array.from({ length: 300 }, (_, i) => ({ code: String(i), sales: 2, pieces: 1 }));
            expect(buildHitsList(rows, new Set(rows.map((r) => r.code)))).toHaveLength(SHOWCASE_LIMIT);
        });
    });

    describe('deals', () => {
        it('скидка от зачёркнутой; без скидки и без остатка — мимо; при равенстве — по коду', () => {
            const list = buildDealsList(
                [
                    { code: '30', price: 7000, originalPrice: 10000 }, // 30 %
                    { code: '20', price: 8000, originalPrice: 10000 }, // 20 %
                    { code: '10', price: 3500, originalPrice: 5000 }, // 30 %, код меньше — раньше 30
                    { code: '40', price: 10000, originalPrice: 10000 }, // нет скидки
                    { code: '50', price: 100, originalPrice: 1000 }, // нет в магазине
                ],
                stock('30', '20', '10', '40'),
            );
            expect(list).toEqual(['10', '30', '20']);
        });
        it('dealDiscount: зачёркнутая ниже цены или ноль — 0', () => {
            expect(dealDiscount({ code: '1', price: 100, originalPrice: 0 })).toBe(0);
            expect(dealDiscount({ code: '1', price: 100, originalPrice: 90 })).toBe(0);
            expect(dealDiscount({ code: '1', price: 75, originalPrice: 100 })).toBe(0.25);
        });
    });
});
