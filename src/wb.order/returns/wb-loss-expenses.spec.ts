import { reconcileWbLossExpenses } from './wb-loss-expenses';
import { emptyProgress } from '../../interfaces/i.job.context';
import { lossPeriod } from '../../helpers/price/marketplace.loss.stats';
import { LossContext } from '../../marketplace-loss/loss.contracts';
import { normalizeWbLoss } from './wb-loss-history.source';
import { normalizeFinancialRow } from '../finance/financial-row';
import { CalculateLossReportCommand, ApplyLossExpensesCommand } from '../../marketplace-loss/loss.commands';
import { lossExpensesPerSale } from '../../marketplace-loss/loss-expenses';

const now = new Date('2026-11-07T10:00:00Z');
const operation = (id: string, orderId: string, offerId = '123') =>
    normalizeWbLoss({
        saleID: id,
        srid: orderId,
        supplierArticle: offerId,
        date: '2026-10-20',
        lastChangeDate: '2026-10-21',
    });
let id: number;
const financial = (ground = '', amount = 0, orderId = '1', extra = {}) =>
    normalizeFinancialRow({
        rrdId: ++id,
        rrDate: '2026-10-20',
        orderDt: '2026-10-10',
        srid: orderId,
        orderId: 10,
        vendorCode: '123',
        nmId: 100,
        shkId: 77,
        sellerOperName: 'Логистика',
        docTypeName: '',
        quantity: 0,
        bonusTypeName: ground,
        deliveryService: String(amount),
        forPay: '0',
        additionalPayment: '0',
        penalty: '0',
        ...extra,
    });
const sold = (orderId: string) =>
    financial('', 0, orderId, { docTypeName: 'Продажа', sellerOperName: 'Продажа', quantity: 1 });
const returned = (orderId: string) =>
    financial('', 0, orderId, { docTypeName: 'Возврат', sellerOperName: 'Возврат', quantity: 1 });
const context = (sales = [operation('S1', '1')]): LossContext => ({
    service: 'WB',
    preliminary: true,
    period: lossPeriod(now),
    sales,
    writeOffs: [],
    rows: [],
    progress: emptyProgress(),
});
const writeOff = (extra = {}) => ({
    id: 1,
    service: 'WB',
    extId: '77',
    posting: '10',
    goodscode: '123',
    pieces: 1,
    units: 1,
    quan: 1,
    spisCode: 20,
    spisSs: 1,
    spisAt: new Date('2026-10-20'),
    documentQuantity: 1,
    ...extra,
});
const refundRows = (orderId = '1') => [
    returned(orderId),
    financial('К клиенту при продаже', 10, orderId),
    financial('От клиента при возврате', 4, orderId),
];

describe('Финансовая сверка расходов ВБ', () => {
    beforeEach(() => (id = 0));
    it('3 продажи, 3 возврата и 3 отмены: 100%; все расходы делятся только на 3 продажи', async () => {
        const ctx = context(
            ['1', '2', '3'].flatMap((order) => [operation('S' + order, order), operation('R' + order, order)]),
        );
        const rows = ['1', '2', '3'].flatMap((order) => [
            sold(order),
            ...refundRows(order),
            financial('К клиенту при отмене', 7, 'cancel-' + order),
            financial('От клиента при отмене', 8, 'cancel-' + order),
        ]);
        rows.push(financial('Возврат брака (К продавцу)', 9));
        const result = await reconcileWbLossExpenses(ctx, rows);
        expect(result.issues).toEqual([]);
        ctx.expenses = result.expenses;
        await new CalculateLossReportCommand().execute(ctx);
        await new ApplyLossExpensesCommand().execute(ctx);
        expect(ctx.rows[0]).toMatchObject({
            soldUnits: 3,
            returnedUnits: 3,
            returnRate: 1,
            expenses: {
                paidReturnDelivery: 42,
                cancellationDelivery: 45,
                sellerReturnDelivery: 9,
                confirmedDefectCompensation: 0,
            },
        });
        expect(lossExpensesPerSale(ctx.rows[0])).toMatchObject({
            paidReturnDelivery: 14,
            cancellationDelivery: 15,
            sellerReturnDelivery: 3,
        });
    });
    it('обычная прямая доставка не считается второй раз', async () => {
        const r = await reconcileWbLossExpenses(context(), [sold('1'), financial('К клиенту при продаже', 10)]);
        expect(r.expenses.get('123').paidReturnDelivery).toBe(0);
        expect(r.issues).toEqual([]);
    });
    it.each(['К клиенту при продаже', 'От клиента при возврате'])(
        'отсутствующая %s даёт NULL, не ноль',
        async (ground) => {
            const r = await reconcileWbLossExpenses(context([operation('S1', '1'), operation('R1', '1')]), [
                sold('1'),
                ...refundRows().filter((row) => row.raw.bonusTypeName !== ground),
            ]);
            expect(r.expenses.get('123').paidReturnDelivery).toBeNull();
            expect(r.issues).toHaveLength(1);
        },
    );
    it('явные нулевые строки означают известную бесплатную доставку', async () => {
        const r = await reconcileWbLossExpenses(context([operation('S1', '1'), operation('R1', '1')]), [
            sold('1'),
            returned('1'),
            financial('К клиенту при продаже', 0),
            financial('От клиента при возврате', 0),
        ]);
        expect(r.expenses.get('123').paidReturnDelivery).toBe(0);
        expect(r.issues).toEqual([]);
    });
    it('неполная отмена не выдаёт полный расход', async () => {
        const r = await reconcileWbLossExpenses(context(), [sold('1'), financial('К клиенту при отмене', 7, 'cancel')]);
        expect(r.expenses.get('123').cancellationDelivery).toBeNull();
    });
    it('неподтверждённые продажи не уменьшаются и не становятся нулевыми расходами', async () => {
        const ctx = context([operation('S1', '1'), operation('S2', '2')]);
        const result = await reconcileWbLossExpenses(ctx, [sold('1')]);
        ctx.expenses = result.expenses;
        await new CalculateLossReportCommand().execute(ctx);
        await new ApplyLossExpensesCommand().execute(ctx);
        expect(ctx.rows[0]).toMatchObject({
            soldUnits: 2,
            expenses: { paidReturnDelivery: null, cancellationDelivery: null },
        });
        expect(result.issues).toHaveLength(1);
    });
    it('исправления и дубли истории используют общий аккумулятор, фасовки не смешиваются', async () => {
        const corrected = { ...operation('S1', '1', '123-4'), changedAt: '2026-10-22' };
        const ctx = context([operation('S1', '1'), corrected, corrected]);
        const r = await reconcileWbLossExpenses(ctx, [
            financial('', 0, '1', {
                vendorCode: '123-4',
                docTypeName: 'Продажа',
                sellerOperName: 'Продажа',
                quantity: 1,
            }),
        ]);
        expect(r.issues).toEqual([]);
        expect([...r.expenses.keys()]).toEqual(['123-4']);
    });
    it('одинаковые rrdId на стыке отчётов не удваивают расходы, конфликт останавливает расчёт', async () => {
        const rows = [sold('1'), financial('Возврат брака (К продавцу)', 9)];
        const ctx = context();
        expect((await reconcileWbLossExpenses(ctx, [...rows, ...rows])).expenses.get('123').sellerReturnDelivery).toBe(
            9,
        );
        await expect(reconcileWbLossExpenses(context(), [...rows, { ...rows[1], delivery_rub: 10 }])).rejects.toThrow(
            'дубль',
        );
    });
    it('коррекция сохраняет знак и относится только к установленному виду доставки', async () => {
        const r = await reconcileWbLossExpenses(context(), [
            sold('1'),
            financial('К клиенту при отмене', 7, 'cancel'),
            financial('От клиента при отмене', 8, 'cancel'),
            financial('коррекция логистики', -1.35, 'cancel'),
        ]);
        expect(r.expenses.get('123').cancellationDelivery).toBe(13.65);
        expect(r.issues).toEqual([]);
    });
    it('коррекция обычной доставки не становится расходом возврата', async () => {
        const r = await reconcileWbLossExpenses(context(), [
            sold('1'),
            financial('К клиенту при продаже', 10),
            financial('коррекция стоимости доставки', -1.35),
        ]);
        expect(r.expenses.get('123').paidReturnDelivery).toBe(0);
        expect(r.issues).toEqual([]);
    });
    it('неустановленное назначение коррекции не угадывается', async () => {
        const r = await reconcileWbLossExpenses(context(), [sold('1'), financial('коррекция логистики', -1.35)]);
        expect(r.expenses.get('123').cancellationDelivery).toBeNull();
    });
    it('стоимость перевозки продавцу учитывается и при нулевых счётчиках deliveryAmount/returnAmount', async () => {
        const r = await reconcileWbLossExpenses(context(), [
            sold('1'),
            financial('Возврат товара, который приехал по МП, продавцу (К продавцу)', 12, '', {
                deliveryAmount: 0,
                returnAmount: 0,
            }),
        ]);
        expect(r.expenses.get('123').sellerReturnDelivery).toBe(12);
    });
    it('дедукция только подтверждённой компенсации того же списания, без скидок и услуг', async () => {
        const ctx = context();
        ctx.writeOffs = [writeOff()];
        const rows = [
            sold('1'),
            ...[
                'Компенсация ущерба',
                'Компенсация скидки по программе лояльности',
                'Возмещение за выдачу и возврат товаров на ПВЗ',
            ].map((sellerOperName) => financial('', 0, '1', { sellerOperName, docTypeName: 'Продажа', forPay: '30' })),
        ];
        expect((await reconcileWbLossExpenses(ctx, rows)).expenses.get('123').confirmedDefectCompensation).toBe(30);
    });
    it.each([{ shkId: 999 }, { vendorCode: '123-4' }, { orderId: 999 }])(
        'компенсация без точной связи %j не вычитается',
        async (extra) => {
            const ctx = context();
            ctx.writeOffs = [writeOff()];
            const r = await reconcileWbLossExpenses(ctx, [
                sold('1'),
                financial('', 0, '1', {
                    sellerOperName: 'Компенсация ущерба',
                    docTypeName: 'Продажа',
                    forPay: '30',
                    ...extra,
                }),
            ]);
            expect(r.expenses.get('123').confirmedDefectCompensation).toBe(0);
        },
    );
    it('старое списание за пределами окна не получает компенсацию нового снимка', async () => {
        const ctx = context();
        ctx.writeOffs = [writeOff({ spisAt: new Date('2026-01-01') })];
        const r = await reconcileWbLossExpenses(ctx, [
            sold('1'),
            financial('', 0, '1', { sellerOperName: 'Компенсация ущерба', docTypeName: 'Продажа', forPay: '30' }),
        ]);
        expect(r.expenses.get('123').confirmedDefectCompensation).toBe(0);
    });
    it('расходы без продаж сохраняются, но неизвестная сумма на одну продажу не делится на ноль', async () => {
        const ctx = context([]);
        const r = await reconcileWbLossExpenses(ctx, [financial('Возврат брака (К продавцу)', 9)]);
        ctx.expenses = r.expenses;
        await new CalculateLossReportCommand().execute(ctx);
        await new ApplyLossExpensesCommand().execute(ctx);
        expect(ctx.rows[0]).toMatchObject({ soldUnits: 0, defectRate: null, expenses: { sellerReturnDelivery: 9 } });
        expect(lossExpensesPerSale(ctx.rows[0]).sellerReturnDelivery).toBeNull();
    });
    it('корректировка продажи не прибавляет продажи', async () => {
        const r = await reconcileWbLossExpenses(context(), [
            sold('1'),
            financial('', 0, '1', {
                sellerOperName: 'Коррекция продаж',
                docTypeName: 'Продажа',
                quantity: 1,
            }),
        ]);
        expect(r.issues).toEqual([]);
    });
    it.each([NaN, Infinity, 0.001])('некорректная сумма %s останавливает расчёт', async (delivery_rub) => {
        const row = financial('Возврат брака (К продавцу)', 1);
        await expect(reconcileWbLossExpenses(context(), [sold('1'), { ...row, delivery_rub }])).rejects.toThrow();
    });
    it('сегодняшний день и чужая площадка не попадают в снимок', async () => {
        const r = await reconcileWbLossExpenses(context(), [
            sold('1'),
            financial('Возврат брака (К продавцу)', 9, '1', { rrDate: '2026-11-07' }),
        ]);
        expect(r.expenses.get('123').sellerReturnDelivery).toBe(0);
        await expect(reconcileWbLossExpenses({ ...context(), service: 'OZON' }, [])).rejects.toThrow('другой площадки');
    });
    it('отмена прерывает работу до публикации результата', async () => {
        await expect(reconcileWbLossExpenses({ ...context(), stopChain: true }, [sold('1')])).rejects.toThrow(
            'остановлена',
        );
    });
});
