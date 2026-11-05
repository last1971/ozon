import { AccrualDto } from '../../posting/dto/accrual.dto';
import { MpEventRowDto } from '../../mp-event/mp-event.service';
import { buildOzonReturnStats } from './ozon.return.stats';
import { readOzonSaleLines } from './ozon.accrual.normalizer';

const accrual = (id: number, amount: number, quantity = 1, sku = 101, posting = '111-222-1'): AccrualDto => ({
    accrual_id: id,
    date: '2026-10-01',
    unit_number: posting,
    accrued_category: 'POSTING',
    total_amount: { amount: '-500', currency: 'RUB' },
    posting: { products: [{ sku, quantity, commission: { sale_amount: { amount: String(amount) } } }] },
});
const event = (
    id: string,
    quantity = 1,
    type = 'ClientReturn',
    sku = 101,
    offerId = '501328-100',
    posting = '111-222-1',
): MpEventRowDto => ({
    extId: id,
    posting,
    firstSeen: new Date('2026-10-02T10:00:00Z'),
    state: 'ReceivedBySeller',
    payload: { id, posting_number: posting, type, product: { sku, offer_id: offerId, quantity } },
});
const catalog = new Map([
    ['101', '501328-100'],
    ['102', '501328-5'],
]);
const report = (accruals: AccrualDto[], returns: MpEventRowDto[] = [], offers = catalog) =>
    buildOzonReturnStats(readOzonSaleLines(accruals), returns, offers);

describe('Предварительная статистика возвратов из журналов Ozon', () => {
    it('пример владельца: 3 продажи, 3 отмены, 3 оплаченных клиентских возврата = 100%', () => {
        const result = report(
            [accrual(1, 300, 3), accrual(2, -300, 3), accrual(3, -300, 3, 101, '333-444-1')],
            [event('r', 3), event('c', 3, 'Cancellation', 101, '501328-100', '333-444-1')],
        );
        expect(result).toEqual({
            rows: [{ offerId: '501328-100', soldUnits: 3, paidReturnUnits: 3, returnPerc: 1 }],
            issues: [],
        });
    });

    it('не считает неоплаченный ClientReturn и логистические услуги возвратом', () => {
        const fee = accrual(2, -10);
        fee.posting.products[0].commission = null;
        expect(report([accrual(1, 100, 3), fee], [event('r', 3)]).rows[0]).toMatchObject({
            soldUnits: 3,
            paidReturnUnits: 0,
            returnPerc: 0,
        });
    });

    it('отрицательное нетто продажи после расходов не превращает продажу в возврат', () => {
        expect(report([accrual(1, 100, 2)]).rows[0].soldUnits).toBe(2);
    });

    it('одинаковое начисление и несколько состояний одного возврата не увеличивают количество', () => {
        const sold = accrual(1, 200, 2);
        const refund = accrual(2, -100);
        const latest = event('r');
        const earlier = { ...latest, state: 'MovingToOzon', firstSeen: new Date('2026-09-30T10:00:00Z') };
        expect(report([sold, sold, refund, refund], [earlier, latest]).rows[0]).toMatchObject({
            soldUnits: 2,
            paidReturnUnits: 1,
            returnPerc: 0.5,
        });
    });

    it('суммирует разные частичные сторно и разные ID возвратов одного SKU', () => {
        expect(
            report([accrual(1, 300, 3), accrual(2, -200, 2), accrual(3, -100)], [event('a', 2), event('b')]).rows[0]
                .returnPerc,
        ).toBe(1);
    });

    it('при частичной оплате считает количество сторно, а не всех заявленных возвратов', () => {
        expect(report([accrual(1, 300, 3), accrual(2, -100)], [event('a', 3)]).rows[0]).toMatchObject({
            paidReturnUnits: 1,
            returnPerc: 1 / 3,
        });
    });

    it('разделяет SKU внутри одного отправления и фасовки одного товара', () => {
        const result = report(
            [accrual(1, 300, 3), accrual(2, 100, 2, 102), accrual(3, -100, 1, 102)],
            [event('a', 1, 'ClientReturn', 102, '501328-5')],
        );
        expect(result.rows).toContainEqual({ offerId: '501328-100', soldUnits: 3, paidReturnUnits: 0, returnPerc: 0 });
        expect(result.rows).toContainEqual({ offerId: '501328-5', soldUnits: 2, paidReturnUnits: 1, returnPerc: 0.5 });
    });

    it('разные SKU одного артикула суммируются без умножения на фасовку', () => {
        const offers = new Map([
            ['101', '501328-100'],
            ['102', '501328-100'],
        ]);
        expect(report([accrual(1, 100, 1), accrual(2, 200, 2, 102)], [], offers).rows[0].soldUnits).toBe(3);
    });

    it('при отсутствии продаж возвращает 0 без деления на ноль', () => {
        expect(report([accrual(1, -100)], [event('a')]).rows[0]).toMatchObject({
            soldUnits: 0,
            paidReturnUnits: 1,
            returnPerc: 0,
        });
    });

    it('возвращает пустой отчёт без истории', () => {
        expect(report([])).toEqual({ rows: [], issues: [] });
    });

    it('берёт артикул из сохранённого возврата, если SKU отсутствует в текущем каталоге', () => {
        expect(report([accrual(1, 100), accrual(2, -100)], [event('a')], new Map()).rows[0].returnPerc).toBe(1);
    });

    it('не выдаёт нулевой процент, если сторно не связано с возвратом', () => {
        const result = report([accrual(1, 300, 3), accrual(2, -100)]);
        expect(result.rows[0].returnPerc).toBeNull();
        expect(result.issues[0].reason).toBe('unmatched-refund');
    });

    it.each([[event('a'), event('c', 1, 'Cancellation')], [event('a')]])(
        'не угадывает количество при смешанной отмене/возврате или избытке сторно',
        (...returns) => {
            const result = report([accrual(1, 200, 2), accrual(2, -200, 2)], returns);
            expect(result.rows[0].returnPerc).toBeNull();
            expect(result.issues[0].reason).toBe('ambiguous-refund');
        },
    );

    it('при конфликте перепроведения с записью возврата не выдаёт достоверный процент', () => {
        const result = buildOzonReturnStats(
            readOzonSaleLines([accrual(1, 100), accrual(2, -100), accrual(3, 100)]),
            [event('r')],
            catalog,
            new Set(['111-222-1']),
        );
        expect(result.rows[0].returnPerc).toBeNull();
        expect(result.issues[0].reason).toBe('ambiguous-rebooking');
    });

    it('сообщает о неизвестном SKU без выдуманного артикула', () => {
        const result = report([accrual(1, 100, 1, 999)]);
        expect(result.rows).toEqual([]);
        expect(result.issues).toEqual([{ reason: 'unmapped-sku', posting: '111-222-1', sku: '999', units: 1 }]);
    });

    it('отклоняет конфликт соответствия SKU артикулу', () => {
        expect(() => report([accrual(1, -100)], [event('a', 1, 'ClientReturn', 101, 'other')])).toThrow(
            'Неоднозначное',
        );
    });

    it('не подставляет 1 вместо неизвестного количества или 0 вместо неизвестной суммы', () => {
        const missing = accrual(1, 100);
        delete missing.posting.products[0].quantity;
        expect(report([missing]).rows[0].returnPerc).toBeNull();
        expect(report([missing]).issues[0].reason).toBe('unknown-quantity');
        missing.posting.products[0].commission = {};
        expect(() => report([missing])).toThrow('суммы');
    });

    it.each([1701, -1701])('старый ответ без quantity: %s / ±189 даёт 9 пачек', (amount) => {
        const old = accrual(1, amount);
        delete old.posting.products[0].quantity;
        old.posting.products[0].commission = {
            sale_amount: { amount: String(amount) },
            seller_price: { amount: String(Math.sign(amount) * 189) },
        };
        expect(readOzonSaleLines([old])[0].units).toBe(9);
    });

    it('дробное отношение суммы к цене не округляет до количества товара', () => {
        const old = accrual(1, 100.5);
        delete old.posting.products[0].quantity;
        old.posting.products[0].commission = { sale_amount: { amount: '100.5' }, seller_price: { amount: '100' } };
        const result = report([old]);
        expect(result.rows[0].returnPerc).toBeNull();
        expect(result.issues[0]).toMatchObject({ reason: 'unknown-quantity', units: null });
    });

    it('не скрывает повреждённый возврат и конфликт одинаковых ID начислений', () => {
        expect(() => report([accrual(1, -100)], [{ ...event('a'), payload: null }])).toThrow('Некорректная запись');
        expect(() => report([accrual(1, 100), accrual(1, 200)])).toThrow('Разные данные');
    });
});
