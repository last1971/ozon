import { ConfigService } from '@nestjs/config';
import { Trade2006GoodService } from './trade2006.good.service';

describe('Чтение наценок ограничено запрошенными товарами до соединения', () => {
    it('фильтрует обе таблицы, сохраняет фасовки и строки только из снимка Ozon', async () => {
        const query = jest.fn().mockResolvedValue([
            { GOODSCODE: 123, PIECES: 1, PERC_MIN: 5, PERC_NOR: 20, PERC_MAX: 40, RETURN_PERC: 0.1 },
            { GOODSCODE: 123, PIECES: 4, PERC_MIN: 10, PERC_NOR: 30, PERC_MAX: 60, RETURN_PERC: 0.2 },
            { GOODSCODE: 456, PIECES: 1, PERC_MIN: null, PERC_NOR: null, PERC_MAX: null, RETURN_PERC: 0.3 },
        ]);
        const transaction = { query, commit: jest.fn() };
        const service = new Trade2006GoodService(
            { getTransaction: async () => transaction } as any,
            new ConfigService(),
            null,
            null,
            null,
        );
        const result = await service.getPerc(['123', '456']);
        const [sql, params] = query.mock.calls[0];
        expect(sql).toMatch(/FROM \(SELECT \* FROM OZON_PERC WHERE GOODSCODE IN \(\?,\?\)\)/);
        expect(sql).toMatch(/WHERE SERVICE = 'OZON'\s+AND GOODSCODE IN \(\?,\?\)/);
        expect(sql).not.toMatch(/WHERE COALESCE/);
        expect(params).toEqual(['123', '456', '123', '456']);
        expect(result).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ offer_id: 123, pieces: 1, min_perc: 5, return_perc: 0.1 }),
                expect.objectContaining({ offer_id: 123, pieces: 4, min_perc: 10, return_perc: 0.2 }),
                expect.objectContaining({ offer_id: 456, pieces: 1, min_perc: null, return_perc: 0.3 }),
            ]),
        );
    });
    it('пакеты не смешивают параметры, пустой список не читает БД', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const pool = { getTransaction: jest.fn().mockResolvedValue({ query, commit: jest.fn() }) };
        const service = new Trade2006GoodService(pool as any, new ConfigService(), null, null, null);
        expect(await service.getPerc([])).toEqual([]);
        expect(pool.getTransaction).not.toHaveBeenCalled();
        const codes = Array.from({ length: 51 }, (_, i) => String(i + 1));
        await service.getPerc(codes);
        expect(query.mock.calls.map(([, params]) => params)).toEqual([
            [...codes.slice(0, 50), ...codes.slice(0, 50)],
            ['51', '51'],
        ]);
    });
});
