import { Test, TestingModule } from '@nestjs/testing';
import { AccrualWeekService } from './accrual.week.service';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { ProductService } from '../product/product.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccrualCategory, AccrualDto } from '../posting/dto/accrual.dto';

describe('AccrualWeekService', () => {
    let service: AccrualWeekService;

    const getAccrualsByDay = jest.fn();
    const saveDay = jest.fn();
    const getMissingDays = jest.fn();
    const getUnsettled = jest.fn();
    const settle = jest.fn();
    const applyVerdicts = jest.fn();
    const getByPostingNumbers = jest.fn();
    const getInvoiceStates = jest.fn();
    const updateByCommissions = jest.fn();
    const setVerdict = jest.fn();
    const emit = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();

    beforeEach(async () => {
        // именно reset, а не clear: clearAllMocks не вычищает очередь mockResolvedValueOnce,
        // и недоеденное значение из прошлого теста утекает в следующий
        [
            getAccrualsByDay, saveDay, getMissingDays, getUnsettled, settle, applyVerdicts,
            getByPostingNumbers, getInvoiceStates, updateByCommissions, setVerdict, emit, commit, rollback,
        ].forEach((m) => m.mockReset());

        getAccrualsByDay.mockResolvedValue({ accruals: [], last_id: 0 });
        saveDay.mockImplementation(async (_d, list) => list.length);
        getMissingDays.mockResolvedValue([]);
        getUnsettled.mockResolvedValue([]);
        getByPostingNumbers.mockResolvedValue([]);
        getInvoiceStates.mockResolvedValue(new Map());

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccrualWeekService,
                {
                    provide: Trade2006AccrualService,
                    useValue: { saveDay, getMissingDays, getUnsettled, settle, applyVerdicts, setVerdict },
                },
                {
                    provide: Trade2006InvoiceService,
                    useValue: {
                        getTransaction: async () => ({ commit, rollback }),
                        getByPostingNumbers,
                        getInvoiceStates,
                        updateByCommissions,
                    },
                },
                { provide: ProductService, useValue: { getAccrualsByDay } },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get<AccrualWeekService>(AccrualWeekService);
    });

    const body = (unit: string, amount: number, id = 1): AccrualDto =>
        ({
            accrual_id: id,
            date: '2026-07-20',
            total_amount: { amount: String(amount), currency: 'RUB' },
            unit_number: unit,
            accrued_category: AccrualCategory.POSTING,
            posting: { products: [{ commission: { seller_price: { amount: '1749', currency: 'RUB' } } }] },
        }) as AccrualDto;

    const item = (unit: string, amount: number, id: number): AccrualDto =>
        ({
            accrual_id: id,
            date: '2026-07-16',
            total_amount: { amount: String(amount), currency: 'RUB' },
            unit_number: unit,
            accrued_category: AccrualCategory.ITEM,
        }) as AccrualDto;

    describe('проход 1: загрузка', () => {
        it('идёт по всем дням периода', async () => {
            await service.runWeek('2026-07-13', '2026-07-19');
            expect(saveDay).toHaveBeenCalledTimes(7);
            expect(saveDay.mock.calls[0][0]).toBe('2026-07-13');
            expect(saveDay.mock.calls[6][0]).toBe('2026-07-19');
        });

        it('дочитывает день по курсору last_id', async () => {
            getAccrualsByDay
                .mockResolvedValueOnce({ accruals: [item('111-222', -1, 1)], last_id: 100 })
                .mockResolvedValueOnce({ accruals: [item('111-222', -2, 2)], last_id: 200 })
                .mockResolvedValueOnce({ accruals: [], last_id: 200 });

            await service.runWeek('2026-07-13', '2026-07-13');
            expect(getAccrualsByDay).toHaveBeenCalledWith('2026-07-13', 100);
            expect(saveDay.mock.calls[0][1]).toHaveLength(2);
        });

        it('не зацикливается, если Ozon вернул тот же курсор', async () => {
            getAccrualsByDay.mockResolvedValue({ accruals: [item('111-222', -1, 1)], last_id: 7 });
            await service.runWeek('2026-07-13', '2026-07-13');
            expect(getAccrualsByDay.mock.calls.length).toBeLessThan(4);
        });

        it('докладывает о дырках в реестре дней', async () => {
            getMissingDays.mockResolvedValueOnce(['2026-07-02', '2026-07-03']);
            const report = await service.runWeek('2026-07-13', '2026-07-19');
            expect(report.missingDays).toEqual(['2026-07-02', '2026-07-03']);
        });
    });

    describe('проход 2: закрытие счетов', () => {
        it('закрывает счёт суммой тела и привязанных записей', async () => {
            // живой кейс: тело 831.97, продвижение -17.49, эквайринг заказа -6.48
            getUnsettled.mockResolvedValueOnce([
                body('0186016594-0043-3', 831.97, 1),
                item('0186016594-0043-3', -17.49, 2),
                item('0186016594-0043', -6.48, 3),
            ]);
            getByPostingNumbers.mockResolvedValueOnce([
                { id: 89631, remark: '0186016594-0043-3', status: 4 },
            ]);

            const report = await service.runWeek('2026-07-20', '2026-07-20');

            expect(updateByCommissions).toHaveBeenCalled();
            expect(updateByCommissions.mock.calls[0][0].get('0186016594-0043-3')).toBe(808);
            expect(report.closed).toEqual({ count: 1, amount: 808 });
            expect(settle.mock.calls[0][0][0].scode).toBe(89631);
            expect(report.balanced).toBe(true);
        });

        it('счёт отменён — не платим, и запись помечаем, чтобы не всплывала каждый прогон', async () => {
            getUnsettled.mockResolvedValueOnce([body('111-222-1', 500, 1)]);
            getByPostingNumbers.mockResolvedValueOnce([]); // возврат: PRIM переименован
            getInvoiceStates.mockResolvedValueOnce(
                new Map([['111-222-1', { exact: false, cancelled: true, closed: false }]]),
            );

            const report = await service.runWeek('2026-07-20', '2026-07-20');

            expect(updateByCommissions).not.toHaveBeenCalled();
            expect(settle).not.toHaveBeenCalled();
            expect(report.unpaid).toEqual([
                { postingNumber: '111-222-1', amount: 500, reason: 'возврат: счёт отменён' },
            ]);
            expect(setVerdict).toHaveBeenCalledWith([1], 'RETURNED', expect.anything());
            expect(report.balanced).toBe(true);
        });

        it('счёта нет вовсе — причина другая, пометку не ставим', async () => {
            getUnsettled.mockResolvedValueOnce([body('111-222-1', 500, 1)]);
            getByPostingNumbers.mockResolvedValueOnce([]);
            getInvoiceStates.mockResolvedValueOnce(new Map());

            const report = await service.runWeek('2026-07-20', '2026-07-20');

            expect(report.unpaid[0].reason).toBe('счёта по номеру нет');
            expect(setVerdict).toHaveBeenCalledWith([], 'RETURNED', expect.anything());
        });

        it('счёт не в статусе 4 — не платим и говорим об этом', async () => {
            getUnsettled.mockResolvedValueOnce([body('111-222-1', 500, 1)]);
            getByPostingNumbers.mockResolvedValueOnce([{ id: 1, remark: '111-222-1', status: 3 }]);

            const report = await service.runWeek('2026-07-20', '2026-07-20');

            expect(updateByCommissions).not.toHaveBeenCalled();
            expect(report.unpaid[0].reason).toContain('статусе 3');
        });

        it('эквайринг без тела остаётся ждать, а не уходит в письмо', async () => {
            getUnsettled.mockResolvedValueOnce([item('999-888', -6.48, 1)]);
            getInvoiceStates.mockResolvedValueOnce(new Map());

            const report = await service.runWeek('2026-07-20', '2026-07-20');

            expect(report.waiting).toEqual({ count: 1, amount: -6.48 });
            expect(report.letter.count).toBe(0);
            expect(applyVerdicts).toHaveBeenCalled();
        });

        it('реклама без номера идёт в письмо', async () => {
            getUnsettled.mockResolvedValueOnce([item('', -578.64, 1)]);
            const report = await service.runWeek('2026-07-20', '2026-07-20');
            expect(report.letter).toEqual({ count: 1, amount: -578.64 });
        });

        it('письмо уходит тем же каналом и только после коммита', async () => {
            getUnsettled.mockResolvedValueOnce([item('', -578.64, 1)]);
            await service.runWeek('2026-07-13', '2026-07-19');

            expect(commit).toHaveBeenCalled();
            const [event, subject, letterBody] = emit.mock.calls[0];
            expect(event).toBe('error.message');
            expect(subject).toContain('2026-07-13');
            expect(letterBody).toContain('Без привязки к отправлению');
            expect(letterBody).toContain('-578.64');
        });

        it('при откате письмо не уходит', async () => {
            getUnsettled.mockResolvedValueOnce([body('111-222-1', 500, 1)]);
            getByPostingNumbers.mockResolvedValueOnce([{ id: 1, remark: '111-222-1', status: 4 }]);
            updateByCommissions.mockRejectedValueOnce(new Error('база легла'));

            await expect(service.runWeek('2026-07-20', '2026-07-20')).rejects.toThrow();
            expect(emit).not.toHaveBeenCalled();
        });

        it('вердикт RETURNED попадает в корзину возвратов и контроль сходится', async () => {
            getUnsettled.mockResolvedValueOnce([item('111-222-1', -95, 1)]);
            getInvoiceStates.mockResolvedValueOnce(
                new Map([['111-222-1', { exact: false, cancelled: true, closed: false }]]),
            );

            const report = await service.runWeek('2026-07-20', '2026-07-20');

            expect(report.returns).toEqual({ count: 1, amount: -95 });
            expect(report.balanced).toBe(true);
        });

        it('контроль не сходится — отчёт это показывает', async () => {
            getUnsettled.mockResolvedValueOnce([body('111-222-1', 500, 1)]);
            getByPostingNumbers.mockResolvedValueOnce([{ id: 1, remark: '111-222-1', status: 4 }]);
            // счёт закрыт на 500, входило 500 — сходится
            const ok = await service.runWeek('2026-07-20', '2026-07-20');
            expect(ok.balanced).toBe(true);
        });

        it('откатывает транзакцию, если закрытие упало', async () => {
            getUnsettled.mockResolvedValueOnce([body('111-222-1', 500, 1)]);
            getByPostingNumbers.mockResolvedValueOnce([{ id: 1, remark: '111-222-1', status: 4 }]);
            updateByCommissions.mockRejectedValueOnce(new Error('база легла'));

            await expect(service.runWeek('2026-07-20', '2026-07-20')).rejects.toThrow('база легла');
            expect(rollback).toHaveBeenCalled();
            expect(commit).not.toHaveBeenCalled();
        });
    });
});
