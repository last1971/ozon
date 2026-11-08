import { SaveTariffDateCommand } from './save-tariff-date.command';
import { PRICING_INPUTS_CHANGED } from '../../helpers/price/pricing-inputs-changed';
import { makeTariffImport, tariffContext, logistics, logisticsName } from './tariff-import.fixtures';
import { emptyProgress } from '../../interfaces/i.job.context';

async function parsed(kind: 'commissions' | 'logistics' = 'commissions') {
    const m = makeTariffImport(),
        context = await tariffContext(kind);
    await m.read.execute(context);
    await m.validate.execute(context);
    await m.parse.execute(context);
    const parseProgress = { ...context.progress, counters: { ...context.progress.counters } };
    context.progress = emptyProgress();
    return { ...m, context, parseProgress };
}

describe('ReadTariffFileCommand', () => {
    it('читает XLSX один раз и сохраняет метаданные в контексте', async () => {
        const m = makeTariffImport(),
            context = await tariffContext();
        await m.read.execute(context);
        expect(context.workbook.worksheets).toHaveLength(1);
        expect(context.meta.fileDate).toBe('2026-10-07');
        expect(context.progress).toMatchObject({ done: 1, total: 1 });
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });
    it.each(['empty', 'broken', 'name', 'cancel'])('отклоняет %s до записи данных', async (reason) => {
        const m = makeTariffImport(),
            context = await tariffContext();
        if (reason === 'empty') context.buffer = Buffer.alloc(0);
        if (reason === 'broken') context.buffer = Buffer.from('not xlsx');
        if (reason === 'name') context.filename = 'bad.xlsx';
        if (reason === 'cancel') context.stopChain = true;
        await expect(m.read.execute(context)).rejects.toThrow();
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });
});
describe('ValidateTariffFileCommand', () => {
    it('проверяет структуру и все карточки, не открывает транзакцию', async () => {
        const m = makeTariffImport(),
            context = await tariffContext();
        await m.read.execute(context);
        context.progress = emptyProgress();
        await m.validate.execute(context);
        expect(context.requiredTypes).toEqual(new Set([1]));
        expect(context.layouts).toHaveLength(1);
        expect(context.progress).toMatchObject({ done: 1, total: 1 });
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });
    it('проверяет оба листа логистики без запросов каталога', async () => {
        const m = makeTariffImport(),
            context = await tariffContext('logistics');
        await m.read.execute(context);
        await m.validate.execute(context);
        expect(context.layouts).toHaveLength(2);
        expect(m.products.listAllOfferIds).not.toHaveBeenCalled();
    });
    it('отсутствующий лист останавливает до разбора строк', async () => {
        const m = makeTariffImport(),
            context = await tariffContext('logistics');
        context.buffer = await logistics({ missingSheet: true });
        await m.read.execute(context);
        await expect(m.validate.execute(context)).rejects.toThrow('нет листа');
    });
    it('ошибка каталога не разрешает импорт', async () => {
        const m = makeTariffImport(),
            context = await tariffContext();
        await m.read.execute(context);
        m.products.infoList.mockResolvedValue([]);
        await expect(m.validate.execute(context)).rejects.toThrow('Прежние тарифы сохранены');
    });
});
describe('ParseTariffRowsCommand', () => {
    it.each(['commissions', 'logistics'] as const)('разбирает %s существующим парсером с прогрессом', async (kind) => {
        const m = await parsed(kind);
        expect(m.context[kind]).not.toHaveLength(0);
        expect(m.parseProgress.done).toBe(m.parseProgress.total);
        expect(m.parseProgress.counters.rows).toBe(m.context[kind].length);
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });
    it('уступает event loop до конца длинного разбора и позволяет прочитать промежуточный прогресс', async () => {
        const m = makeTariffImport(),
            context = await tariffContext();
        await m.read.execute(context);
        await m.validate.execute(context);
        const sheet = context.workbook.worksheets[0];
        for (let i = 4; i <= 303; i++) {
            sheet.getRow(i).values = (sheet.getRow(3).values as any[]).slice(1);
            sheet.getCell(i, 3).value = `Тип ${i}`;
        }
        context.progress = emptyProgress();
        const pending = m.parse.execute(context);
        let observed: number;
        await new Promise<void>((resolve) =>
            setImmediate(() => {
                observed = context.progress.done;
                resolve();
            }),
        );
        expect(observed).toBeGreaterThan(0);
        expect(observed).toBeLessThan(context.progress.total);
        await pending;
        expect(context.progress.done).toBe(context.progress.total);
        expect(context.commissions).toHaveLength(301);
    });
    it('отмена в середине разбора не доходит до записи', async () => {
        const m = makeTariffImport(),
            context = await tariffContext();
        await m.read.execute(context);
        await m.validate.execute(context);
        context.stopChain = true;
        await expect(m.parse.execute(context)).rejects.toThrow('остановлена');
        expect(m.pool.getTransaction).not.toHaveBeenCalled();
    });
});
describe('WriteTariffsCommand', () => {
    it('пишет партиями 20/20/5, считает строки, оставляет транзакцию до фиксации даты', async () => {
        const m = await parsed('logistics');
        m.context.logistics = Array.from({ length: 45 }, (_, i) => ({ ...m.context.logistics[0], volumeFrom: i }));
        await m.write.execute(m.context);
        expect(m.tx.execute.mock.calls.filter(([sql]) => sql.startsWith('EXECUTE BLOCK'))).toHaveLength(3);
        expect(m.context.progress).toMatchObject({ done: 45, total: 45, counters: { written: 45 } });
        expect(m.tx.commit).not.toHaveBeenCalled();
        expect(m.context.transaction).toBe(m.tx);
    });
    it('не очищает комиссии, если нет тарифа для своего товара', async () => {
        const m = await parsed();
        m.context.requiredTypes.add(999);
        await expect(m.write.execute(m.context)).rejects.toThrow('типов товаров кабинета');
        expect(m.tx.execute.mock.calls.some(([sql]) => sql.includes('FBO_COMMISSIONS = NULL'))).toBe(false);
    });
    it('ошибка записи не фиксирует частичные данные', async () => {
        const m = await parsed('logistics');
        m.tx.execute.mockImplementation(async (sql) => {
            if (sql.startsWith('EXECUTE BLOCK')) throw new Error('write failed');
            return [];
        });
        await expect(m.write.execute(m.context)).rejects.toThrow('write failed');
        expect(m.tx.commit).not.toHaveBeenCalled();
    });
});
describe('SaveTariffDateCommand', () => {
    it('записывает дату завершения и фиксирует строки вместе с метаданными', async () => {
        const m = await parsed('logistics');
        await m.write.execute(m.context);
        m.context.progress = emptyProgress();
        m.context.result.uploadedAt = new Date(0);
        await m.saveDate.execute(m.context);
        const args = m.tx.execute.mock.calls.find(([sql]) => sql.includes('UPLOADED_AT = ?'))[1];
        expect(args[0]).toBe(logisticsName);
        expect(args[2]).toBe(m.context.result.uploadedAt);
        expect(m.context.result.uploadedAt.getTime()).toBeGreaterThan(0);
        expect(m.tx.commit).toHaveBeenCalledTimes(1);
        expect(m.context.transaction).toBeUndefined();
        expect(m.context.progress).toMatchObject({ done: 1, total: 1 });
    });
    it('ошибка даты не делает COMMIT', async () => {
        const m = await parsed('logistics');
        await m.write.execute(m.context);
        m.tx.execute.mockRejectedValue(new Error('metadata failed'));
        await expect(m.saveDate.execute(m.context)).rejects.toThrow('metadata failed');
        expect(m.tx.commit).not.toHaveBeenCalled();
    });
    it('отмена перед фиксацией не меняет дату и не делает COMMIT', async () => {
        const m = await parsed('logistics');
        await m.write.execute(m.context);
        m.tx.execute.mockClear();
        m.context.stopChain = true;
        await expect(m.saveDate.execute(m.context)).rejects.toThrow('остановлена');
        expect(m.tx.execute).not.toHaveBeenCalled();
        expect(m.tx.commit).not.toHaveBeenCalled();
    });
});

it('изменение тарифов будит очередь только после успешного commit', async () => {
    const m = await parsed();
    await m.write.execute(m.context);
    const events = { emit: jest.fn() };
    await new SaveTariffDateCommand(events as any).execute(m.context);
    expect(events.emit).toHaveBeenCalledWith(PRICING_INPUTS_CHANGED, { service: 'OZON' });
    expect(m.tx.commit.mock.invocationCallOrder[0]).toBeLessThan(events.emit.mock.invocationCallOrder[0]);
});
it('неудачный commit тарифов не будит очередь', async () => {
    const m = await parsed();
    await m.write.execute(m.context);
    m.tx.commit.mockRejectedValueOnce(new Error('commit failed'));
    const events = { emit: jest.fn() };
    await expect(new SaveTariffDateCommand(events as any).execute(m.context)).rejects.toThrow('commit failed');
    expect(events.emit).not.toHaveBeenCalled();
});
