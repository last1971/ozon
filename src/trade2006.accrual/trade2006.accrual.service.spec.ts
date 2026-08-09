import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006AccrualService } from './trade2006.accrual.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { AccrualCategory, AccrualDto } from '../posting/dto/accrual.dto';
import { PendingVerdict } from '../helpers/accrual.distribution';

describe('Trade2006AccrualService', () => {
    let service: Trade2006AccrualService;
    const query = jest.fn();
    const execute = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Trade2006AccrualService,
                {
                    provide: FIREBIRD,
                    useValue: { getTransaction: () => ({ query, execute, commit, rollback }) },
                },
            ],
        }).compile();
        service = module.get<Trade2006AccrualService>(Trade2006AccrualService);
    });

    const acc = (over: Partial<AccrualDto> = {}): AccrualDto =>
        ({
            accrual_id: 56106907752,
            date: '2026-07-16',
            total_amount: { amount: '-6.48', currency: 'RUB' },
            unit_number: '0186016594-0043',
            accrued_category: AccrualCategory.ITEM,
            ...over,
        }) as AccrualDto;

    describe('saveDay', () => {
        it('кладёт запись апсертом и не трогает VERDICT с SETTLED_AT', async () => {
            await service.saveDay('2026-07-16', [acc()]);

            const [sql, params] = execute.mock.calls[0];
            expect(sql).toContain('UPDATE OR INSERT INTO OZON_ACCRUAL');
            expect(sql).toContain('MATCHING (ACCRUAL_ID)');
            // иначе повторная загрузка недели затрёт уже сделанное разнесение
            expect(sql).not.toContain('VERDICT');
            expect(sql).not.toContain('SETTLED_AT');
            expect(params[0]).toBe('56106907752'); // id уходит строкой: в диалекте 1 нет BIGINT
            expect(params[6]).toBe(-6.48);
        });

        it('размечает вид номера: заказ, отправление, пусто', async () => {
            await service.saveDay('2026-07-16', [
                acc({ unit_number: '0186016594-0043' }),
                acc({ accrual_id: 2, unit_number: '0186016594-0043-3' }),
                acc({ accrual_id: 3, unit_number: '' }),
            ]);
            expect(execute.mock.calls[0][1][3]).toBe(1); // заказ
            expect(execute.mock.calls[1][1][3]).toBe(2); // отправление
            expect(execute.mock.calls[2][1][3]).toBe(0); // реклама без номера
        });

        it('помечает тело продажи: POSTING с блоком commission', async () => {
            await service.saveDay('2026-07-20', [
                acc({
                    unit_number: '0186016594-0043-3',
                    accrued_category: AccrualCategory.POSTING,
                    posting: { products: [{ commission: { seller_price: { amount: '1749', currency: 'RUB' } } }] },
                }),
                acc({
                    accrual_id: 2,
                    unit_number: '0186016594-0043-3',
                    accrued_category: AccrualCategory.POSTING,
                    posting: { products: [{ commission: null }] }, // только услуги доставки
                }),
            ]);
            expect(execute.mock.calls[0][1][5]).toBe(1);
            expect(execute.mock.calls[1][1][5]).toBe(0);
        });

        it('отмечает день в реестре', async () => {
            await service.saveDay('2026-07-16', [acc(), acc({ accrual_id: 2 })]);
            const [sql, params] = execute.mock.calls.at(-1);
            expect(sql).toContain('MERGE INTO OZON_ACCRUAL_DAY');
            expect(params).toEqual(['2026-07-16', 2]);
        });
    });

    describe('getMissingDays', () => {
        it('находит дырки в непрерывности', async () => {
            query.mockResolvedValueOnce([{ ACCRUAL_DATE: '2026-07-13' }, { ACCRUAL_DATE: '2026-07-15' }]);
            expect(await service.getMissingDays('2026-07-13', '2026-07-16')).toEqual([
                '2026-07-14',
                '2026-07-16',
            ]);
        });

        it('дата из драйвера не съезжает на сутки назад', async () => {
            // Драйвер отдаёт Date локальной полуночи; toISOString() увёл бы 16-е в 15-е.
            // Тогда отсчёт пошёл бы с 15-го и в пропуск попало бы 16-е.
            query.mockResolvedValueOnce([{ ACCRUAL_DATE: new Date(2026, 6, 16) }]);
            expect(await service.getMissingDays('2026-07-15', '2026-07-17')).toEqual(['2026-07-17']);
        });

        it('на первом прогоне не считает дырками всю историю до начала журнала', async () => {
            // журнал начат 13.07, окно проверки — с 20.05: до 13.07 дырок нет
            query.mockResolvedValueOnce([{ ACCRUAL_DATE: '2026-07-13' }, { ACCRUAL_DATE: '2026-07-14' }]);
            expect(await service.getMissingDays('2026-05-20', '2026-07-14')).toEqual([]);
        });

        it('пустой журнал — дырок нет', async () => {
            query.mockResolvedValueOnce([]);
            expect(await service.getMissingDays('2026-05-20', '2026-07-14')).toEqual([]);
        });

        it('на полной неделе дырок нет', async () => {
            query.mockResolvedValueOnce([
                { ACCRUAL_DATE: '2026-07-13' },
                { ACCRUAL_DATE: '2026-07-14' },
            ]);
            expect(await service.getMissingDays('2026-07-13', '2026-07-14')).toEqual([]);
        });
    });

    describe('getUnsettled', () => {
        it('поднимает неразнесённые и восстанавливает признак тела', async () => {
            query.mockResolvedValueOnce([
                {
                    ACCRUAL_ID: '56220000001',
                    ACCRUAL_DATE: '2026-07-20',
                    UNIT_NUMBER: '0186016594-0043-3',
                    CATEGORY: 'POSTING',
                    IS_BODY: 1,
                    AMOUNT: 831.97,
                },
                {
                    ACCRUAL_ID: '56106907752',
                    ACCRUAL_DATE: '2026-07-16',
                    UNIT_NUMBER: '0186016594-0043',
                    CATEGORY: 'ITEM',
                    IS_BODY: 0,
                    AMOUNT: -6.48,
                },
            ]);

            const rows = await service.getUnsettled();
            const [sql, params] = query.mock.calls[0];
            expect(sql).toContain('SETTLED_AT IS NULL');
            expect(params).toEqual([PendingVerdict.WAITING, PendingVerdict.STALE]);

            expect(rows[0].posting.products[0].commission).toBeDefined();
            expect(rows[0].total_amount.amount).toBe('831.97');
            expect(rows[1].posting).toBeUndefined();
            expect(rows[1].accrual_id).toBe(56106907752);
        });
    });

    describe('settle', () => {
        it('пишет доли и помечает записи разнесёнными', async () => {
            await service.settle([
                {
                    scode: 89631,
                    parts: [
                        { accrualId: 56220000001, amount: 831.97 },
                        { accrualId: 56106907752, amount: -6.48 },
                    ],
                },
            ]);

            const inserts = execute.mock.calls.filter(([sql]) => sql.includes('OZON_ACCRUAL_PART'));
            expect(inserts).toHaveLength(2);
            expect(inserts[0][0]).toContain('MATCHING (ACCRUAL_ID, SCODE)'); // повтор прогона безопасен
            expect(inserts[0][1]).toEqual(['56220000001', 89631, 831.97]);

            const marks = execute.mock.calls.filter(([sql]) => sql.includes('SETTLED_AT = CURRENT_TIMESTAMP'));
            expect(marks).toHaveLength(2);
        });
    });

    describe('applyVerdicts', () => {
        it('ставит вердикт, но SETTLED_AT не трогает: деньги в счёт не ушли', async () => {
            await service.applyVerdicts([
                { verdict: PendingVerdict.RETURNED, accrual: acc(), postingNumber: '0186016594-0043-3' },
            ]);
            const [sql, params] = execute.mock.calls[0];
            expect(sql).toContain('SET VERDICT = ?');
            expect(sql).not.toContain('SETTLED_AT');
            expect(params).toEqual([PendingVerdict.RETURNED, '56106907752']);
        });
    });
});
