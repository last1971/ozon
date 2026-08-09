import { classifyPending, distributeAccruals, InvoiceState, PendingVerdict } from './accrual.distribution';
import { AccrualCategory, AccrualDto } from '../posting/dto/accrual.dto';

let seq = 0;

const acc = (unit: string, amount: number, category = AccrualCategory.ITEM): AccrualDto =>
    ({
        accrual_id: ++seq,
        date: '2026-07-13',
        total_amount: { amount: String(amount), currency: 'RUB' },
        unit_number: unit,
        accrued_category: category,
    }) as AccrualDto;

/** Тело продажи: POSTING с блоком commission. total_amount уже нетто. */
const body = (unit: string, amount: number, sellerPrice = 1749): AccrualDto =>
    ({
        ...acc(unit, amount, AccrualCategory.POSTING),
        posting: {
            delivery_schema: 'Fbs',
            products: [
                {
                    sku: 1,
                    delivery: { services: [{ type_id: 32, accrued: { amount: '-65', currency: 'RUB' } }] },
                    commission: { seller_price: { amount: String(sellerPrice), currency: 'RUB' } },
                },
            ],
        },
    }) as AccrualDto;

/** POSTING без commission: услуги по отправлению, которое не продалось. */
const deliveryOnly = (unit: string, amount: number): AccrualDto =>
    ({
        ...acc(unit, amount, AccrualCategory.POSTING),
        posting: { delivery_schema: 'Fbs', products: [{ sku: 1, delivery: {}, commission: null }] },
    }) as AccrualDto;

const totalOf = (list: AccrualDto[]): number =>
    Math.round(list.reduce((s, a) => s + parseFloat(a.total_amount.amount), 0) * 100) / 100;

describe('distributeAccruals', () => {
    beforeEach(() => {
        seq = 0;
    });

    it('тело закрывает счёт своего отправления', () => {
        const { settlements, pending } = distributeAccruals([body('111-222-1', 480.05)]);
        expect(settlements).toHaveLength(1);
        expect(settlements[0].postingNumber).toBe('111-222-1');
        expect(settlements[0].amount).toBe(480.05);
        expect(pending).toHaveLength(0);
    });

    it('услуги внутри тела не вычитаются второй раз', () => {
        // total_amount = 831.97 уже за вычетом комиссии и логистики (живой кейс 0186016594-0043-3)
        const { settlements } = distributeAccruals([body('111-222-3', 831.97)]);
        expect(settlements[0].amount).toBe(831.97);
    });

    it('отдельная запись отправления суммируется с телом', () => {
        const { settlements } = distributeAccruals([
            body('111-222-3', 831.97),
            acc('111-222-3', -17.49), // продвижение бренда отдельной записью
        ]);
        expect(settlements[0].amount).toBe(814.48);
    });

    it('эквайринг заказа из прошлого прогона подбирается пришедшим телом', () => {
        // живой кейс: эквайринг -6.48 от 16.07, тело +831.97 от 20.07
        const acquiring = acc('111-222', -6.48);
        const { settlements } = distributeAccruals([acquiring, body('111-222-3', 831.97), acc('111-222-3', -17.49)]);
        expect(settlements[0].amount).toBe(808.0);
        expect(settlements[0].parts.map((p) => p.accrualId)).toContain(acquiring.accrual_id);
    });

    it('списание на заказ делится между его телами пропорционально нетто', () => {
        const { settlements } = distributeAccruals([body('111-222-1', 300), body('111-222-2', 100), acc('111-222', -40)]);
        const byNumber = new Map(settlements.map((s) => [s.postingNumber, s.amount]));
        expect(byNumber.get('111-222-1')).toBe(270);
        expect(byNumber.get('111-222-2')).toBe(90);
    });

    it('дележ по заказу не теряет копейки', () => {
        const { settlements } = distributeAccruals([
            body('111-222-1', 100),
            body('111-222-2', 100),
            body('111-222-3', 100),
            acc('111-222', -0.01),
        ]);
        const total = settlements.reduce((s, x) => s + x.amount, 0);
        expect(Math.round(total * 100) / 100).toBe(299.99);
    });

    it('эквайринг без тела ждёт в журнале, а не уходит в письмо', () => {
        const { settlements, pending, unattributed } = distributeAccruals([acc('999-888', -12)]);
        expect(settlements).toHaveLength(0);
        expect(pending).toHaveLength(1);
        expect(unattributed).toHaveLength(0);
    });

    it('чужой заказ с похожим префиксом не задевается', () => {
        const { settlements, pending } = distributeAccruals([body('111-2220-1', 100), acc('111-222', -50)]);
        expect(settlements).toHaveLength(1);
        expect(settlements[0].amount).toBe(100);
        expect(pending).toHaveLength(1);
    });

    it('реклама без номера идёт в письмо', () => {
        const { settlements, unattributed } = distributeAccruals([
            body('111-222-1', 700),
            acc('', -578.64, AccrualCategory.NON_ITEM), // страхование товара
        ]);
        expect(settlements[0].amount).toBe(700);
        expect(unattributed).toHaveLength(1);
        expect(unattributed[0].total_amount.amount).toBe('-578.64');
    });

    it('отрицательное тело — возврат: счёт не закрывается', () => {
        const { settlements, returns } = distributeAccruals([body('111-222-1', -653.22, -3333), acc('111-222-1', -15)]);
        expect(settlements).toHaveLength(0);
        expect(returns).toHaveLength(2);
    });

    it('услуги отправления без тела ждут в журнале', () => {
        // логистика по невыкупу: тела нет и, возможно, не будет
        const { settlements, pending } = distributeAccruals([deliveryOnly('111-222-1', -95)]);
        expect(settlements).toHaveLength(0);
        expect(pending).toHaveLength(1);
    });

    it('сторно возврата не приклеивается к телу и не меняет сумму', () => {
        const { settlements, returns } = distributeAccruals([body('111-222-1', 1808.44)]);
        expect(settlements[0].amount).toBe(1808.44);
        expect(returns).toHaveLength(0);
    });

    it('ничего не теряется: вход равен сумме всех корзин', () => {
        const input = [
            body('111-222-1', 300),
            body('111-222-2', 100),
            acc('111-222', -40),
            acc('111-222-1', -17.49),
            body('333-444-1', -653.22, -3333), // возврат
            acc('333-444-1', -15),
            acc('999-888', -12), // эквайринг без тела
            deliveryOnly('555-666-1', -95),
            acc('', -578.64, AccrualCategory.NON_ITEM),
        ];
        const { settlements, returns, pending, unattributed } = distributeAccruals(input);
        const out =
            settlements.reduce((s, x) => s + x.amount, 0) +
            totalOf(returns) +
            totalOf(pending) +
            totalOf(unattributed);
        expect(Math.round(out * 100) / 100).toBe(totalOf(input));
    });

    it('поделённая между счетами запись разносится долями, в сумме дающими её целиком', () => {
        const split = acc('111-222', -40);
        const input = [body('111-222-1', 300), body('111-222-2', 100), split, acc('111-222-1', -17.49)];
        const { settlements } = distributeAccruals(input);

        const shares = settlements.flatMap((s) => s.parts).filter((p) => p.accrualId === split.accrual_id);
        expect(shares).toHaveLength(2); // попала в оба счёта заказа
        expect(round2(shares.reduce((s, p) => s + p.amount, 0))).toBe(-40);

        // каждая запись входа где-то разнесена, лишних долей нет
        const ids = settlements.flatMap((s) => s.parts.map((p) => p.accrualId));
        expect(new Set(ids)).toEqual(new Set(input.map((a) => a.accrual_id)));
    });
});

const round2 = (v: number): number => Math.round(v * 100) / 100;

describe('classifyPending', () => {
    const dated = (unit: string, date: string): AccrualDto => ({ ...acc(unit, -95), date });
    const state = (exact: boolean, renamed: boolean): InvoiceState => ({ exact, renamed });
    const run = (list: AccrualDto[], invoices: Map<string, InvoiceState>) =>
        classifyPending(list, invoices, { today: '2026-08-02' }).map((c) => c.verdict);

    it('счёт живой, тела нет — ждём дальше', () => {
        const invoices = new Map([['111-222-1', state(true, false)]]);
        expect(run([dated('111-222-1', '2026-07-28')], invoices)).toEqual([PendingVerdict.WAITING]);
    });

    it('PRIM переименован возвратом — ждать нечего', () => {
        // «15503858-0803-1 отмена FBO»: точного совпадения нет, префикс есть
        const invoices = new Map([['111-222-1', state(false, true)]]);
        expect(run([dated('111-222-1', '2026-07-28')], invoices)).toEqual([PendingVerdict.RETURNED]);
    });

    it('счёта нет вовсе — в отчёт', () => {
        expect(run([dated('111-222-1', '2026-07-28')], new Map())).toEqual([PendingVerdict.NO_INVOICE]);
    });

    it('живой счёт, но запись висит дольше порога — в отчёт', () => {
        const invoices = new Map([['111-222-1', state(true, false)]]);
        expect(run([dated('111-222-1', '2026-07-01')], invoices)).toEqual([PendingVerdict.STALE]);
    });

    it('переименованный счёт даёт возврат независимо от давности', () => {
        const invoices = new Map([['111-222-1', state(false, true)]]);
        expect(run([dated('111-222-1', '2026-06-01')], invoices)).toEqual([PendingVerdict.RETURNED]);
    });

    it('запись уровня заказа ждёт, пока не упрётся в порог', () => {
        expect(run([dated('111-222', '2026-07-28')], new Map())).toEqual([PendingVerdict.WAITING]);
        expect(run([dated('111-222', '2026-07-01')], new Map())).toEqual([PendingVerdict.STALE]);
    });
});
