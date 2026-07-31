import { CreateFboInvoiceCommand } from './create-fbo-invoice.command';
import { IFboCreateContext } from './i.fbo-create.context';
import { GoodServiceEnum } from '../../good/good.service.enum';

describe('CreateFboInvoiceCommand', () => {
    const createInvoiceFromPostingDto = jest.fn();
    const update = jest.fn();
    const pickupInvoice = jest.fn();
    const findFboPodbposCandidates = jest.fn();
    const findFboPodbposDonor = jest.fn();
    const decrementPodbpos = jest.fn();
    const logMigrationLink = jest.fn();
    const migrate = jest.fn();

    const invoiceService = {
        createInvoiceFromPostingDto,
        update,
        pickupInvoice,
        findFboPodbposCandidates,
        findFboPodbposDonor,
        decrementPodbpos,
        logMigrationLink,
    };
    const command = new CreateFboInvoiceCommand(invoiceService as any, { migrate } as any);

    const invoice = { id: 999, status: 3, invoiceLines: [{ goodCode: '444', quantity: 2, price: '1', realpricecode: 300 }] };

    const ctx = (over: Partial<IFboCreateContext>): IFboCreateContext =>
        ({
            service: GoodServiceEnum.OZON,
            posting: { posting_number: '321', in_process_at: '2026-01-01', products: [{ offer_id: '444', price: '1', quantity: 2 }] } as any,
            prims: ['W'],
            primLabel: 'W',
            buyerId: 7,
            useMigration: true,
            setIgkNot1c: true,
            pickupAfterCreate: false,
            skipIfNoPodbor: false,
            transaction: null,
            ...over,
        });

    beforeEach(() => {
        [createInvoiceFromPostingDto, update, pickupInvoice, findFboPodbposCandidates, findFboPodbposDonor, decrementPodbpos, logMigrationLink, migrate].forEach(
            (m) => m.mockReset(),
        );
        createInvoiceFromPostingDto.mockResolvedValue(invoice);
        migrate.mockResolvedValue([]);
    });

    describe('migration', () => {
        it('Ozon: создать → migrate(posting) → IGK, без pickup; недостач нет', async () => {
            const res = await command.execute(ctx({}));
            expect(migrate).toHaveBeenCalledWith(ctx({}).posting.products, ['W'], invoice.invoiceLines, 999, null, '321');
            expect(update).toHaveBeenCalledWith(invoice, { IGK: 'NOT1C' }, null);
            expect(pickupInvoice).not.toHaveBeenCalled();
            expect(res.invoice).toBe(invoice);
            expect(res.shortages).toEqual([]);
        });

        it('migrate вернул недобор → счёт остаётся, недобор собран в контекст', async () => {
            migrate.mockResolvedValueOnce([{ goodscode: '444', quantity: 1 }]);
            const res = await command.execute(ctx({}));
            expect(res.invoice).toBe(invoice); // счёт НЕ отменяется
            expect(res.shortages).toEqual([{ goodscode: '444', quantity: 1 }]);
        });

        it('WB: pickup после создания, без IGK', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([{ quanAvail: 1 }]);
            await command.execute(ctx({ service: GoodServiceEnum.WB, setIgkNot1c: false, pickupAfterCreate: true, skipIfNoPodbor: true }));
            expect(pickupInvoice).toHaveBeenCalledWith(invoice, null);
            expect(update).not.toHaveBeenCalled();
        });
    });

    describe('legacy', () => {
        it('донор есть → снять ДО создания + записать цепочку, без недостачи', async () => {
            findFboPodbposDonor.mockResolvedValueOnce({ podbposcode: 1, scode: 10, realpricecode: 100, quanAvail: 5 });

            const res = await command.execute(ctx({ useMigration: false }));

            expect(decrementPodbpos).toHaveBeenCalledWith(1, 2, null);
            expect(decrementPodbpos.mock.invocationCallOrder[0]).toBeLessThan(
                createInvoiceFromPostingDto.mock.invocationCallOrder[0],
            );
            expect(logMigrationLink).toHaveBeenCalledWith(
                { posting: '321', goodscode: '444', quantity: 2, donorScode: 10, donorRpc: 100, targetScode: 999, targetRpc: 300 },
                null,
            );
            expect(res.shortages).toEqual([]);
            expect(res.invoice).toBe(invoice);
        });

        it('донора нет → позиция в недостачу, счёт всё равно создан', async () => {
            findFboPodbposDonor.mockResolvedValueOnce(null);

            const res = await command.execute(ctx({ useMigration: false }));

            expect(decrementPodbpos).not.toHaveBeenCalled();
            expect(logMigrationLink).not.toHaveBeenCalled();
            expect(createInvoiceFromPostingDto).toHaveBeenCalled();
            expect(res.invoice).toBe(invoice);
            expect(res.shortages).toEqual([{ goodscode: '444', quantity: 2 }]);
        });
    });

    describe('WB «левый» заказ (skipIfNoPodbor)', () => {
        it('нет подбора вовсе → счёт не создаём, stopChain', async () => {
            findFboPodbposDonor.mockResolvedValueOnce(null);
            const res = await command.execute(ctx({ useMigration: false, skipIfNoPodbor: true }));
            expect(res.stopChain).toBe(true);
            expect(res.invoice).toBeNull();
            expect(createInvoiceFromPostingDto).not.toHaveBeenCalled();
        });

        it('migration: кандидатов нет → счёт не создаём', async () => {
            findFboPodbposCandidates.mockResolvedValueOnce([]);
            const res = await command.execute(ctx({ useMigration: true, skipIfNoPodbor: true }));
            expect(res.stopChain).toBe(true);
            expect(createInvoiceFromPostingDto).not.toHaveBeenCalled();
        });
    });
});
