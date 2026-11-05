import { OzonReturnStore } from './ozon.return.store';

const at = new Date('2026-11-05T02:38:00Z');
const values = [{ goodscode: '123', pieces: 5, returnPerc: 1 / 3 }];
const setup = () => {
    const t = {
        query: jest.fn().mockResolvedValue([]),
        execute: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
    };
    const pool = { getTransaction: jest.fn().mockResolvedValue(t) };
    return { t, pool, store: new OzonReturnStore(pool as any) };
};
describe('Атомарное сохранение возвратов в OZON_PERC', () => {
    it('пишет только статистику по товару и фасовке, округляет лишь при сохранении', async () => {
        const { store, t } = setup();
        await store.save(values, at);
        expect(t.execute.mock.calls).toEqual([
            ['UPDATE OZON_PERC SET RETURN_PERC = ?, RETURN_PERC_AT = ?', [0, at], false],
            [
                'UPDATE OR INSERT INTO OZON_PERC (GOODSCODE, PIECES, RETURN_PERC, RETURN_PERC_AT) VALUES (?, ?, ?, ?) MATCHING (GOODSCODE, PIECES)',
                ['123', 5, 0.333333, at],
                false,
            ],
        ]);
        expect(t.commit).toHaveBeenCalledWith(true);
        expect(t.rollback).not.toHaveBeenCalled();
    });
    it('сбрасывает устаревшую историю в резервную долю тем же снимком', async () => {
        const { store, t } = setup();
        await store.save(values, at, 0.05);
        expect(t.execute.mock.calls[0][1]).toEqual([0.05, at]);
    });
    it.each(['query', 'execute', 'commit'])('сбой %s откатывает весь снимок', async (method) => {
        const { store, t } = setup();
        t[method].mockRejectedValueOnce(new Error('failure'));
        await expect(store.save(values, at)).rejects.toThrow('failure');
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('ошибка второй строки откатывает сброс и первую строку', async () => {
        const { store, t } = setup();
        t.execute
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('second'));
        await expect(store.save([...values, { goodscode: '124', pieces: 1, returnPerc: 1 }], at)).rejects.toThrow(
            'second',
        );
        expect(t.commit).not.toHaveBeenCalled();
        expect(t.rollback).toHaveBeenCalledWith(true);
    });
    it('старый снимок не перезаписывает новый', async () => {
        const { store, t } = setup();
        t.query.mockResolvedValue([{ GOODSCODE: 123 }]);
        await expect(store.save(values, at)).rejects.toThrow('более новый');
        expect(t.execute).not.toHaveBeenCalled();
    });
    it('пустой снимок ничего не меняет', async () => {
        const { store, pool } = setup();
        await store.save([], at);
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it.each([-1, 1.1, NaN, Infinity, null, undefined])('не открывает запись при доле %s', async (returnPerc) => {
        const { store, pool } = setup();
        await expect(store.save([{ ...values[0], returnPerc }], at)).rejects.toThrow();
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
    it('не открывает запись при дубликате, неверной дате или ключе', async () => {
        const { store, pool } = setup();
        await expect(store.save([...values, ...values], at)).rejects.toThrow();
        await expect(store.save(values, new Date(NaN))).rejects.toThrow();
        await expect(store.save([{ ...values[0], pieces: 0 }], at)).rejects.toThrow();
        expect(pool.getTransaction).not.toHaveBeenCalled();
    });
});
