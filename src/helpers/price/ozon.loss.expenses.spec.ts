import { readOzonLossFees, calculateOzonLossExpenses, OzonLossFee } from './ozon.loss.expenses';
import { lossPeriod, calculateLossRates } from './marketplace.loss.stats';
import { ozonPostingSkuKey } from './ozon.return.evidence';
import { lossExpensesPerSale } from '../../marketplace-loss/loss-expenses';
import { calculateMarketplaceLossCosts } from './marketplace.loss.costs';
import { AccrualDto } from '../../posting/dto/accrual.dto';

const period = lossPeriod(new Date('2026-11-07'));
const types = [
    { id: 32, name: 'Logistic', description: '' },
    { id: 59, name: 'ReturnFlowLogistic', description: '' },
    { id: 71, name: 'SellerReturns', description: '' },
    { id: 25, name: 'ItemCompensation', description: '' },
];
const fee = (name: string, cents: number, extra: Partial<OzonLossFee> = {}): OzonLossFee => ({
    name,
    cents,
    sku: '10',
    posting: 'cancel',
    units: 1,
    ...extra,
});
const row = (offerId = '123', soldUnits = 3) => ({
    offerId,
    soldUnits,
    returnedUnits: 3,
    writtenOffUnits: 1,
    ...calculateLossRates({ soldUnits, returnedUnits: 3, writtenOffUnits: 1 }),
});
const evidence = () => ({
    offers: new Map([
        ['10', '123'],
        ['11', '123-4'],
    ]),
    clients: new Map<string, number>(),
    cancellations: new Set([ozonPostingSkuKey('cancel', '10')]),
});
const writeOff = {
    id: 1,
    service: 'OZON',
    extId: 'return-1',
    posting: 'cancel',
    goodscode: '123',
    pieces: 1,
    units: 1,
    quan: 1,
    spisCode: 20,
    spisSs: 1,
    spisAt: new Date('2026-10-20'),
    documentQuantity: 1,
};
const accrual = (extra = {}): AccrualDto => ({
    accrual_id: 1,
    date: '2026-10-20',
    unit_number: 'cancel',
    total_amount: { amount: '-500', currency: 'RUB' },
    accrued_category: 'POSTING',
    posting: {
        products: [
            {
                sku: 10,
                quantity: 1,
                delivery: { services: [{ type_id: 32, accrued: { amount: '-10', currency: 'RUB' } }] },
            },
        ],
    },
    ...extra,
});

describe('Расходы Ozon из существующего журнала', () => {
    it('читает услуги, не прибавляя второй раз total_amount', async () => {
        expect(await readOzonLossFees([accrual()], types, period)).toEqual([fee('Logistic', 1000)]);
    });
    it('одинаковые начисления не удваивают услуги, противоречивые останавливают расчёт', async () => {
        expect(await readOzonLossFees([accrual(), accrual()], types, period)).toHaveLength(1);
        await expect(
            readOzonLossFees([accrual(), accrual({ total_amount: { amount: '-4', currency: 'RUB' } })], types, period),
        ).rejects.toThrow();
    });
    it('расходы отказов делятся на положительные продажи; возвраты Ozon продолжают использовать свои тарифы', async () => {
        const r = await calculateOzonLossExpenses(
            [fee('Logistic', 900), fee('ReturnFlowLogistic', 600), fee('SellerReturns', 300)],
            [row()],
            [writeOff],
            evidence(),
            new Set(),
        );
        expect(r.issues).toEqual([]);
        expect(r.expenses.get('123')).toEqual({
            cancellationDelivery: 15,
            sellerReturnDelivery: 3,
            confirmedDefectCompensation: 0,
        });
        const statistics = lossExpensesPerSale({ ...row(), expenses: r.expenses.get('123') });
        expect(statistics).not.toHaveProperty('paidReturnDelivery');
        expect(calculateMarketplaceLossCosts({ ...statistics, purchaseCost: 90 }, 20)).toMatchObject({
            returns: 20,
            cancellations: 5,
            sellerReturns: 1,
            defects: 30,
            total: 56,
        });
    });
    it('доставка оплаченного возврата не прибавляется к уже действующему тарифному резерву', async () => {
        const e = evidence();
        e.cancellations.clear();
        e.clients.set(ozonPostingSkuKey('cancel', '10'), 1);
        const r = await calculateOzonLossExpenses(
            [fee('Logistic', 900), fee('ReturnFlowLogistic', 600)],
            [row()],
            [],
            e,
            new Set(),
        );
        expect(r.expenses.get('123').cancellationDelivery).toBe(0);
        expect(r.issues).toEqual([]);
    });
    it('отменённый счёт подтверждает отказ при отсутствии события', async () => {
        const e = evidence();
        e.cancellations.clear();
        const r = await calculateOzonLossExpenses(
            [fee('Logistic', 900), fee('ReturnFlowLogistic', 600)],
            [row()],
            [],
            e,
            new Set(['cancel']),
        );
        expect(r.expenses.get('123').cancellationDelivery).toBe(15);
        expect(r.issues).toEqual([]);
    });
    it('обратная доставка без подтверждённого типа возврата не выдаётся за бесплатную', async () => {
        const e = evidence();
        e.cancellations.clear();
        const r = await calculateOzonLossExpenses([fee('ReturnFlowLogistic', 600)], [row()], [], e, new Set());
        expect(r.expenses.get('123').cancellationDelivery).toBeNull();
        expect(r.issues).toHaveLength(1);
    });
    it('отказ с единственной прямой доставкой также неполон', async () => {
        const r = await calculateOzonLossExpenses([fee('Logistic', 900)], [row()], [], evidence(), new Set());
        expect(r.expenses.get('123').cancellationDelivery).toBeNull();
    });
    it('одновременно отказ и клиентский возврат не угадываются', async () => {
        const e = evidence();
        e.clients.set(ozonPostingSkuKey('cancel', '10'), 1);
        const r = await calculateOzonLossExpenses([fee('ReturnFlowLogistic', 600)], [row()], [], e, new Set());
        expect(r.expenses.get('123').cancellationDelivery).toBeNull();
    });
    it('компенсация без товара/отправления не уменьшает резерв брака', async () => {
        const r = await calculateOzonLossExpenses(
            [fee('ItemCompensation', -3000, { sku: null, posting: '' })],
            [row()],
            [writeOff],
            evidence(),
            new Set(),
        );
        expect(r.expenses.get('123').confirmedDefectCompensation).toBe(0);
    });
    it('компенсация вычитается только у той же фасовки, отправления и количества подтверждённого списания', async () => {
        const r = await calculateOzonLossExpenses(
            [
                fee('ItemCompensation', -3000),
                fee('ItemCompensation', -5000, { sku: '11' }),
                fee('ItemCompensation', -5000, { posting: 'other' }),
                fee('ItemCompensation', -5000, { units: null }),
            ],
            [row(), row('123-4')],
            [writeOff],
            evidence(),
            new Set(),
        );
        expect(r.expenses.get('123').confirmedDefectCompensation).toBe(30);
        expect(r.expenses.get('123-4').confirmedDefectCompensation).toBe(0);
    });
    it('положительные корректировки услуг уменьшают расход, а не увеличивают его', async () => {
        const r = await calculateOzonLossExpenses(
            [fee('SellerReturns', 1000), fee('SellerReturns', -135)],
            [row()],
            [],
            evidence(),
            new Set(),
        );
        expect(r.expenses.get('123').sellerReturnDelivery).toBe(8.65);
    });
    it('нет продаж — нет расходов на одну продажу, без деления на ноль', async () => {
        const r = await calculateOzonLossExpenses(
            [fee('SellerReturns', 1000)],
            [row('123', 0)],
            [],
            evidence(),
            new Set(),
        );
        expect(
            lossExpensesPerSale({ ...row('123', 0), expenses: r.expenses.get('123') }).sellerReturnDelivery,
        ).toBeNull();
    });
    it('несопоставленный SKU не теряется молча', async () => {
        await expect(
            calculateOzonLossExpenses([fee('SellerReturns', 1000, { sku: '999' })], [row()], [], evidence(), new Set()),
        ).rejects.toThrow('SKU');
    });
    it('сегодняшние начисления не попадают в 90 завершённых дней', async () => {
        expect(await readOzonLossFees([accrual({ date: period.to })], types, period)).toEqual([]);
    });
    it.each([{ dictionary: [] }, { dictionary: [...types, types[0]] }])(
        'не принимает отсутствующий/неоднозначный словарь',
        async ({ dictionary }) => {
            await expect(readOzonLossFees([accrual()], dictionary, period)).rejects.toThrow(/словар/);
        },
    );
    it('отмена job прерывает длинный разбор', async () => {
        await expect(
            readOzonLossFees([accrual()], types, period, { progress: { done: 0, counters: {} }, stopChain: true }),
        ).rejects.toThrow('остановлена');
    });
});
