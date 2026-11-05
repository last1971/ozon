import { AccrualDto } from '../../posting/dto/accrual.dto';
import { normalizeOzonRebookings, readOzonSaleLines } from './ozon.accrual.normalizer';

const entry = (id: number, direction = 1, posting = '111-222-1'): AccrualDto => {
    const money = (value: number) => ({ amount: String(direction * value), currency: 'RUB' });
    return {
        accrual_id: id,
        date: id === 1 ? '2026-08-18' : '2026-08-19',
        unit_number: posting,
        accrued_category: 'POSTING',
        total_amount: money(1316.38),
        posting: {
            delivery_schema: 'Fbo',
            products: [
                {
                    sku: 101,
                    quantity: 1,
                    delivery: {
                        total_accrued: money(-109),
                        services: [
                            { type_id: 32, accrued: money(-84) },
                            { type_id: 98, accrued: money(-25) },
                        ],
                    },
                    commission: {
                        seller_price: money(2299),
                        sale_amount: money(2299),
                        sale_price: money(1822),
                        sale_commission: money(-873.62),
                        commission: money(-873.62),
                        bonus: money(477),
                        coinvestment: money(0),
                        commission_ratio: '0.380000',
                    },
                },
            ],
        },
        item_fees: null,
        non_item_fee: null,
        container_fees: null,
    };
};
const collapse = (rows: AccrualDto[], protectedPostings: string[] = []) =>
    normalizeOzonRebookings(rows, new Set(protectedPostings)).accruals;

describe('Нормализация перепроведений Ozon', () => {
    it('полное +A, -A, +A оставляет одну продажу', () => {
        const rows = collapse([entry(1), entry(2, -1), entry(3)]);
        expect(rows.map((row) => row.accrual_id)).toEqual([3]);
        expect(readOzonSaleLines(rows)).toEqual([{ posting: '111-222-1', sku: '101', units: 1, kind: 'sale' }]);
    });

    it('несколько последовательных перепроведений оставляют последнее начисление', () => {
        expect(collapse([entry(1), entry(2, -1), entry(3), entry(4, -1), entry(5)]).map((a) => a.accrual_id)).toEqual([
            5,
        ]);
    });

    it('даты и числовой порядок ID важнее порядка входного массива', () => {
        expect(collapse([entry(11), entry(10, -1), entry(9)]).map((a) => a.accrual_id)).toEqual([11]);
    });

    it('дата приоритетнее ID', () => {
        const original = { ...entry(30), date: '2026-08-17' };
        const reversal = { ...entry(20, -1), date: '2026-08-18' };
        expect(collapse([entry(10), original, reversal]).map((a) => a.accrual_id)).toEqual([10]);
    });

    it.each([
        [entry(1), entry(2, -1)],
        [entry(2, -1), entry(3)],
        [entry(1), entry(3)],
    ])('не сворачивает неполную цепочку', (...rows) => {
        expect(collapse(rows)).toEqual(rows);
    });

    it('наличие записи возврата запрещает автоматическое сворачивание', () => {
        const rows = [entry(1), entry(2, -1), entry(3)];
        expect(collapse(rows, ['111-222-1'])).toEqual(rows);
        expect(normalizeOzonRebookings(rows, new Set(['111-222-1'])).ambiguousPostings).toEqual(new Set(['111-222-1']));
        expect(collapse(rows, ['other'])).toHaveLength(1);
    });

    it.each([
        [
            'валюта',
            (a: AccrualDto) => {
                a.total_amount.currency = 'USD';
            },
        ],
        [
            'сумма нетто',
            (a: AccrualDto) => {
                a.total_amount.amount = '1316.39';
            },
        ],
        [
            'SKU',
            (a: AccrualDto) => {
                a.posting.products[0].sku = 102;
            },
        ],
        [
            'количество',
            (a: AccrualDto) => {
                a.posting.products[0].quantity = 2;
            },
        ],
        [
            'схема',
            (a: AccrualDto) => {
                a.posting.delivery_schema = 'Fbs';
            },
        ],
        [
            'доставка',
            (a: AccrualDto) => {
                (a.posting.products[0].delivery as any).total_accrued.amount = '-108';
            },
        ],
        [
            'комиссия',
            (a: AccrualDto) => {
                (a.posting.products[0].commission as any).commission.amount = '-873.61';
            },
        ],
        [
            'частичная сумма',
            (a: AccrualDto) => {
                (a.posting.products[0].commission as any).sale_amount.amount = '1000';
            },
        ],
        [
            'битая денежная сумма',
            (a: AccrualDto) => {
                a.total_amount.amount = 'invalid';
            },
        ],
        [
            'нет суммы нетто',
            (a: AccrualDto) => {
                delete a.total_amount.amount;
            },
        ],
    ])('не сворачивает несовпадение: %s', (_label, change) => {
        const replacement = entry(3);
        change(replacement);
        expect(collapse([entry(1), entry(2, -1), replacement])).toHaveLength(3);
    });

    it('сторно только продажи без обратных сумм доставки не является полным перепроведением', () => {
        const reversal = entry(2, -1);
        reversal.posting.products[0].delivery = null;
        expect(collapse([entry(1), reversal, entry(3)])).toHaveLength(3);
    });

    it('равные суммы разных отправлений не объединяются', () => {
        expect(collapse([entry(1), entry(2, -1, 'other'), entry(3)])).toHaveLength(3);
    });

    it('не скрывает промежуточную отличающуюся операцию того же отправления', () => {
        const other = entry(2);
        other.posting.products[0].sku = 102;
        expect(collapse([entry(1), other, entry(3, -1), entry(4)])).toHaveLength(4);
    });

    it('постороннее отправление не мешает перепроведению', () => {
        expect(collapse([entry(1), entry(2, 1, 'other'), entry(3, -1), entry(4)]).map((a) => a.accrual_id)).toEqual([
            2, 4,
        ]);
    });

    it('сравнивает деньги точно, учитывает нулевые суммы и формат десятичных знаков', () => {
        const replacement = entry(3);
        replacement.total_amount.amount = '01316.3800';
        (replacement.posting.products[0].commission as any).coinvestment.amount = '-0.00';
        expect(collapse([entry(1), entry(2, -1), replacement])).toEqual([replacement]);
    });

    it('не теряет малую разницу в большой денежной сумме', () => {
        const original = entry(1),
            reversal = entry(2, -1),
            replacement = entry(3);
        original.total_amount.amount = '9007199254740992.01';
        reversal.total_amount.amount = '-9007199254740992.01';
        replacement.total_amount.amount = '9007199254740992.02';
        expect(collapse([original, reversal, replacement])).toHaveLength(3);
    });

    it('повторы одного ID не создают ложную цепочку, противоречивый повтор отклоняется', () => {
        const original = entry(1);
        expect(collapse([original, original, entry(2, -1), entry(3)])).toHaveLength(1);
        expect(() => collapse([entry(1), entry(1, -1)])).toThrow('Разные данные');
    });

    it('две товарные строки сравниваются целиком', () => {
        const rows = [entry(1), entry(2, -1), entry(3)];
        for (const row of rows) row.posting.products.push({ ...row.posting.products[0], sku: 102 });
        expect(collapse(rows)).toHaveLength(1);
        rows[1].posting.products[1].quantity = 2;
        expect(collapse(rows)).toHaveLength(3);
    });

    it('не изменяет исходный массив и записи', () => {
        const rows = [entry(3), entry(2, -1), entry(1)];
        const before = JSON.stringify(rows);
        collapse(rows);
        expect(JSON.stringify(rows)).toBe(before);
    });
});
