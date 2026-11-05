import { makeTariffImport, tariffContext } from './tariff-import.fixtures';
import { OzonCategoryController } from '../ozon.category.controller';

const gate = () => {
    let release: () => void;
    const promise = new Promise<void>((r) => (release = r));
    return { promise, release: () => release() };
};
const tick = () => new Promise<void>((r) => setImmediate(r));

describe('Цепочка импорта XLSX через JobService', () => {
    it.each(['commissions', 'logistics'] as const)(
        'возвращает id сразу, выполняет все фазы %s, фиксирует данные один раз',
        async (kind) => {
            const m = makeTariffImport(),
                c = await tariffContext(kind),
                phases: string[] = [];
            for (const command of [m.read, m.validate, m.parse, m.write, m.saveDate]) {
                const execute = command.execute.bind(command);
                jest.spyOn(command, 'execute').mockImplementation(async (ctx) => {
                    phases.push(ctx.progress.phase);
                    return execute(ctx);
                });
            }
            const state = m.imports.start(kind, c.buffer, c.filename, 'browser-1');
            expect(state.id).toBeTruthy();
            expect(state.status).toBe('running');
            expect(state.clientId).toBe('browser-1');
            expect(m.tx.commit).not.toHaveBeenCalled();
            const done = await m.jobs.whenDone(state.id);
            expect(done).toMatchObject({ status: 'done', progress: { percent: 100 } });
            expect(phases).toEqual([
                'чтение файла',
                'проверка структуры',
                'разбор строк',
                'запись в Firebird',
                'фиксация даты загрузки',
            ]);
            expect(done.result).toMatchObject({ fileDate: kind === 'commissions' ? '2026-10-07' : '2026-10-30' });
            expect(m.tx.commit).toHaveBeenCalledTimes(1);
            expect(m.tx.rollback).not.toHaveBeenCalled();
        },
    );
    it.each(['write', 'metadata', 'commit'])(
        'ошибка %s откатывает транзакцию и не выдаёт успешный результат',
        async (where) => {
            const m = makeTariffImport(),
                c = await tariffContext('logistics');
            if (where === 'commit') m.tx.commit.mockRejectedValue(new Error('commit failed'));
            else
                m.tx.execute.mockImplementation(async (sql) => {
                    if (
                        (where === 'write' && sql.startsWith('EXECUTE BLOCK')) ||
                        (where === 'metadata' && sql.includes('FILE_NAME = ?'))
                    )
                        throw new Error(where + ' failed');
                    return [];
                });
            const state = m.imports.start(c.kind, c.buffer, c.filename),
                done = await m.jobs.whenDone(state.id);
            expect(done.status).toBe('failed');
            expect(done.progress.percent).toBeLessThan(100);
            expect(done.result).toBeUndefined();
            expect(m.tx.rollback).toHaveBeenCalledTimes(1);
        },
    );
    it('повтор загрузки того же файла возвращает ту же задачу', async () => {
        const m = makeTariffImport(),
            c = await tariffContext();
        const a = m.imports.start(c.kind, c.buffer, c.filename),
            b = m.imports.start(c.kind, c.buffer, c.filename);
        expect(a.id).toBe(b.id);
        await m.jobs.whenDone(a.id);
        expect(m.tx.commit).toHaveBeenCalledTimes(1);
    });
    it('отмена между записью строк и датой откатывает данные и пропускает последнюю команду', async () => {
        const m = makeTariffImport(),
            c = await tariffContext('logistics'),
            g = gate(),
            ready = gate();
        const write = m.write.execute.bind(m.write);
        jest.spyOn(m.write, 'execute').mockImplementation(async (ctx) => {
            const r = await write(ctx);
            ready.release();
            await g.promise;
            return r;
        });
        const save = jest.spyOn(m.saveDate, 'execute');
        const state = m.imports.start(c.kind, c.buffer, c.filename);
        await ready.promise;
        m.jobs.cancel(state.id);
        g.release();
        const done = await m.jobs.whenDone(state.id);
        expect(done.status).toBe('failed');
        expect(save).not.toHaveBeenCalled();
        expect(m.tx.rollback).toHaveBeenCalledTimes(1);
        expect(m.tx.commit).not.toHaveBeenCalled();
    });
    it('прогресс доступен через get во время записи, не ждёт завершения SQL', async () => {
        const m = makeTariffImport(),
            c = await tariffContext('logistics'),
            g = gate(),
            ready = gate();
        m.tx.execute.mockImplementation(async (sql) => {
            if (sql.startsWith('EXECUTE BLOCK')) {
                ready.release();
                await g.promise;
            }
            return [];
        });
        const state = m.imports.start(c.kind, c.buffer, c.filename);
        await ready.promise;
        const snapshot = JSON.parse(JSON.stringify(m.jobs.get(state.id)));
        expect(snapshot).toMatchObject({
            status: 'running',
            progress: { phase: 'запись в Firebird', percent: 50, total: 8 },
        });
        g.release();
        expect((await m.jobs.whenDone(state.id)).status).toBe('done');
    });
    it('контроллер возвращает job для обоих файлов и передаёт метку браузера', async () => {
        const service = { startImport: jest.fn().mockReturnValue({ id: 'job-id', status: 'running' }) };
        const controller = new OzonCategoryController(null, null, null, service as any);
        const file = { buffer: Buffer.from('xlsx'), originalname: 'tariff.xlsx' } as Express.Multer.File;
        expect(await controller.importCommissions(file, 'client')).toMatchObject({ id: 'job-id' });
        expect(await controller.importLogistics(file, 'client')).toMatchObject({ id: 'job-id' });
        expect(service.startImport.mock.calls.map((args) => [args[0], args[3]])).toEqual([
            ['commissions', 'client'],
            ['logistics', 'client'],
        ]);
    });
});
