import { JobService } from '../job/job.service';
import { emptyProgress } from '../interfaces/i.job.context';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { lossPeriod, calculateLossRates } from '../helpers/price/marketplace.loss.stats';
import { ApplyLossExpensesCommand, SaveLossSnapshotCommand } from './loss.commands';
import {
    PrepareWbLossFinancialCommand,
    ReconcileWbLossExpensesCommand,
    WbLossFinancialCommands,
} from '../wb.order/returns/wb-loss-financial.commands';
import {
    ValidateWbFinancialReportCommand,
    LoadWbFinancialReportCommand,
    NormalizeWbFinancialReportCommand,
} from '../wb.order/finance/financial-report.commands';
import { WbLossService } from '../wb.order/returns/wb-loss.service';
import { LoadWbLossSalesCommand } from '../wb.order/returns/load-sales.command';
import { LoadWbWriteOffsCommand } from '../wb.order/returns/load-write-offs.command';
import { CalculateWbLossReportCommand } from '../wb.order/returns/calculate-loss-report.command';
import {
    LoadOzonLossFinancialsCommand,
    ReadOzonLossFeesCommand,
    ResolveOzonLossExpensesCommand,
    CalculateOzonLossExpensesCommand,
    OzonLossFinancialCommands,
    OzonLossExpenseContext,
} from '../trade2006.accrual/ozon.loss.expense.commands';
const now = new Date('2026-11-07T10:00:00Z');
const raw = {
    rrdId: 1,
    rrDate: '2026-10-20',
    orderDt: '2026-10-10',
    srid: '1',
    orderId: 1,
    vendorCode: '123',
    nmId: 100,
    sellerOperName: 'Продажа',
    docTypeName: 'Продажа',
    quantity: 1,
    deliveryService: '0',
    forPay: '100',
    additionalPayment: '0',
    penalty: '0',
};
const context = (): OzonLossExpenseContext => ({
    service: 'OZON',
    preliminary: false,
    period: lossPeriod(now),
    calculatedAt: now,
    sales: [],
    writeOffs: [],
    rows: [
        {
            offerId: '123',
            soldUnits: 3,
            returnedUnits: 0,
            writtenOffUnits: 0,
            ...calculateLossRates({ soldUnits: 3, returnedUnits: 0, writtenOffUnits: 0 }),
        },
    ],
    progress: emptyProgress(),
    catalog: [],
    skuToOffer: new Map([['10', '123']]),
    knownOffers: [],
    minSales: 1,
    defaultPerc: 0,
});
const types = [
    { id: 32, name: 'Logistic', description: '' },
    { id: 59, name: 'ReturnFlowLogistic', description: '' },
];
const accrual: any = {
    accrual_id: 1,
    date: '2026-10-20',
    unit_number: 'cancel',
    accrued_category: 'POSTING',
    total_amount: { amount: '-15', currency: 'RUB' },
    posting: {
        products: [
            {
                sku: 10,
                delivery: {
                    services: [
                        { type_id: 32, accrued: { amount: '-10', currency: 'RUB' } },
                        { type_id: 59, accrued: { amount: '-5', currency: 'RUB' } },
                    ],
                },
            },
        ],
    },
};

describe('Цепочки финансовых расходов с общим JobService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());
    it('ВБ: недельные и ежедневные команды, сверка, общие проценты/расходы, одна запись', async () => {
        const jobs = new JobService();
        const reader = { page: jest.fn().mockResolvedValueOnce([raw]).mockResolvedValue([]) };
        const financial = new WbLossFinancialCommands(
            new PrepareWbLossFinancialCommand(),
            new ValidateWbFinancialReportCommand(),
            new LoadWbFinancialReportCommand(reader as any),
            new NormalizeWbFinancialReportCommand(),
            new ReconcileWbLossExpensesCommand(),
        );
        const store = { read: jest.fn(), replace: jest.fn().mockResolvedValue(undefined) };
        const orders = {
            getSales: jest
                .fn()
                .mockResolvedValueOnce([
                    {
                        saleID: 'S1',
                        supplierArticle: '123',
                        srid: '1',
                        date: '2026-10-20',
                        lastChangeDate: '2026-10-21',
                    },
                ])
                .mockResolvedValue([]),
        };
        const service = new WbLossService(
            jobs,
            new ConfigService({ SERVICES: ['wb'] }),
            new LoadWbLossSalesCommand(orders as any),
            new LoadWbWriteOffsCommand({ listRecordedWriteOffs: async () => [] } as any),
            new CalculateWbLossReportCommand(),
            new SaveLossSnapshotCommand(store),
            financial,
        );
        const done = await jobs.whenDone(service.start(undefined, now).id);
        expect(done.status).toBe('done');
        expect(done.progress.percent).toBe(100);
        expect(reader.page).toHaveBeenCalledTimes(3);
        expect(store.replace).toHaveBeenCalledTimes(1);
        expect(store.replace.mock.calls[0][0]).toMatchObject({
            service: 'WB',
            preliminary: false,
            rows: [
                {
                    soldUnits: 1,
                    returnRate: 0,
                    defectRate: 0,
                    expenses: {
                        paidReturnDelivery: 0,
                        cancellationDelivery: 0,
                        sellerReturnDelivery: 0,
                        confirmedDefectCompensation: 0,
                    },
                },
            ],
        });
    });
    it('ВБ: незакрытая неделя отделена, московский понедельник не запрашивает лишний daily', async () => {
        const ctx: any = context();
        ctx.service = 'WB';
        ctx.period = lossPeriod(new Date('2026-11-09T10:00:00Z'));
        await new PrepareWbLossFinancialCommand().execute(ctx);
        expect(ctx.financialWindows.map((w) => w.reportPeriod)).toEqual(['weekly']);
        expect(ctx.financialWindows[0].to).toContain('2026-11-08T23:59:59.999');
    });
    it('ошибка загрузки ВБ не доходит до сохранения', async () => {
        const ctx: any = context();
        ctx.service = 'WB';
        const reader = {
            page: async () => {
                throw Error('Нет отчёта');
            },
        };
        const financial = new WbLossFinancialCommands(
            new PrepareWbLossFinancialCommand(),
            new ValidateWbFinancialReportCommand(),
            new LoadWbFinancialReportCommand(reader as any),
            new NormalizeWbFinancialReportCommand(),
            new ReconcileWbLossExpensesCommand(),
        );
        const save = jest.fn(async (c) => c);
        const jobs = new JobService();
        const job = jobs.run({
            kind: 'test-wb-expenses',
            params: {},
            context: ctx,
            commands: [...financial.loading, { execute: save }],
            result: (c) => c.rows,
        });
        expect((await jobs.whenDone(job.id)).status).toBe('failed');
        expect(save).not.toHaveBeenCalled();
    });
    it('Ozon: чтение, разбор, основания, расчёт и присоединение проходят одной job', async () => {
        const ctx = context();
        const transaction = { rollback: jest.fn() };
        const accruals = { listLossAccruals: jest.fn().mockResolvedValue([accrual]) };
        const events = { findRows: jest.fn().mockResolvedValue([]) };
        const load = new LoadOzonLossFinancialsCommand(
            { getTransaction: async () => transaction } as any,
            accruals as any,
            events as any,
            { getAccrualTypes: async () => types } as any,
        );
        const invoices = {
            getInvoiceStates: jest
                .fn()
                .mockResolvedValue(new Map([['cancel', { exact: false, closed: false, cancelled: true }]])),
        };
        const chain = new OzonLossFinancialCommands(
            load,
            new ReadOzonLossFeesCommand(),
            new ResolveOzonLossExpensesCommand(invoices as any),
            new CalculateOzonLossExpensesCommand(),
        );
        const jobs = new JobService();
        const job = jobs.run({
            kind: 'test-ozon-expenses',
            params: {},
            context: ctx,
            commands: [...chain.loading, chain.calculate, new ApplyLossExpensesCommand()],
            result: (c) => c.rows,
        });
        const done = await jobs.whenDone(job.id);
        expect(done).toMatchObject({ status: 'done', progress: { percent: 100 } });
        expect(ctx.rows[0].expenses).toEqual({
            cancellationDelivery: 15,
            sellerReturnDelivery: 0,
            confirmedDefectCompensation: 0,
        });
        expect(transaction.rollback).toHaveBeenCalledWith(true);
        expect(events.findRows).toHaveBeenCalledWith('OZON', 'RETURN', { postings: ['cancel'] }, transaction);
        expect(invoices.getInvoiceStates).toHaveBeenCalledWith(['cancel']);
    });
    it('Ozon: ошибка чтения освобождает транзакцию, не публикуя расходы', async () => {
        const transaction = { rollback: jest.fn() };
        const load = new LoadOzonLossFinancialsCommand(
            { getTransaction: async () => transaction } as any,
            {
                listLossAccruals: async () => {
                    throw Error('Ошибка БД');
                },
            } as any,
            null,
            null,
        );
        const ctx = context();
        await expect(load.execute(ctx)).rejects.toThrow('Ошибка БД');
        expect(transaction.rollback).toHaveBeenCalledWith(true);
        expect(ctx.expenses).toBeUndefined();
    });
    it('Ozon: проверка 81 отправления использует существующее пакетное чтение, а не 81 запрос', async () => {
        const ctx = context();
        ctx.expenseAccruals = [];
        ctx.expenseEvents = [];
        ctx.expenseFees = Array.from({ length: 81 }, (_, i) => ({
            posting: String(i),
            sku: '10',
            name: 'ReturnFlowLogistic',
            cents: 100,
            units: 1,
        }));
        const invoices = {
            getInvoiceStates: jest.fn(
                async (batch) =>
                    new Map(batch.map((posting) => [posting, { exact: false, closed: false, cancelled: true }])),
            ),
        };
        await new ResolveOzonLossExpensesCommand(invoices as any).execute(ctx);
        expect(invoices.getInvoiceStates).toHaveBeenCalledTimes(3);
        expect(ctx.expenseCancelled.size).toBe(81);
        expect(ctx.progress).toMatchObject({ done: 81, total: 81 });
    });
    it('неразобранные расходы не выдаются за пустые, отмена выполняется до чтения БД', async () => {
        const ctx = context();
        await expect(new ReadOzonLossFeesCommand().execute(ctx)).rejects.toThrow('Не загружены');
        await expect(new ResolveOzonLossExpensesCommand(null).execute(ctx)).rejects.toThrow('Не разобраны');
        await expect(new CalculateOzonLossExpensesCommand().execute(ctx)).rejects.toThrow('Не подтверждены');
        await expect(
            new LoadOzonLossFinancialsCommand(null, null, null, null).execute({ ...ctx, stopChain: true }),
        ).rejects.toThrow('остановлена');
    });
});
