import { ConfigService } from '@nestjs/config';
import { Trade2006ReturnStockService } from './trade2006.return-stock.service';

describe('Групповое чтение строк и марок возврата', () => {
    it.each(['SHOPSKLAD', 'SKLAD'])(
        'сохраняет количества, фасовки и принадлежность строк счетам: %s',
        async (storage) => {
            const service = new Trade2006ReturnStockService(null, new ConfigService({ STORAGE_TYPE: storage }));
            const t = {
                query: jest.fn(async (_sql: string, _args: number[], _auto: boolean) => [
                    {
                        SCODE: 1,
                        REALPRICECODE: 10,
                        GOODSCODE: 500,
                        QUAN: 30,
                        PIECES: 10,
                        PICKED: 20,
                        NEED: 10,
                        SHIPPED: 10,
                    },
                    {
                        SCODE: 2,
                        REALPRICECODE: 20,
                        GOODSCODE: 500,
                        QUAN: 5,
                        PIECES: null,
                        PICKED: 5,
                        NEED: 0,
                        SHIPPED: -1,
                    },
                ]),
            };
            const result = await service.getLinesMany([1, 2, 1], t as any);
            expect(result.get(1)).toEqual([
                expect.objectContaining({
                    realpricecode: 10,
                    goodscode: '500',
                    quantity: 30,
                    pieces: 10,
                    picked: 20,
                    need: 10,
                    shipped: 10,
                }),
            ]);
            expect(result.get(2)).toEqual([
                expect.objectContaining({ realpricecode: 20, quantity: 5, pieces: null, shipped: 0 }),
            ]);
            expect(t.query).toHaveBeenCalledTimes(1);
            expect(t.query.mock.calls[0][0]).toContain(
                storage === 'SHOPSKLAD' ? 'pp.QUANSHOP AS PICKED' : 'pp.QUANSKLAD AS PICKED',
            );
        },
    );

    it('марки остаются на своих строках со своим QUANTITY и признаком вывода', async () => {
        const service = new Trade2006ReturnStockService(null, new ConfigService({ MARK_CODES_ENABLED: true }));
        const t = {
            query: jest.fn(async () => [
                {
                    REALPRICECODE: 10,
                    KI: 'A',
                    QUANTITY: 10,
                    STATUS: 6,
                    TRANSFER_TYPE: 3,
                    RETIRE_REASON: 1,
                    CHZ_SENT_AT: new Date(),
                },
                { REALPRICECODE: 20, KI: 'B', QUANTITY: 2, STATUS: 5, TRANSFER_TYPE: 0, RETIRE_REASON: null },
            ]),
        };
        const result = await service.getLineCodesMany([10, 20], t as any);
        expect(result.get(10)).toEqual([
            { ki: 'A', quantity: 10, status: 6, transferType: 3, retireReason: 1, chzSent: true },
        ]);
        expect(result.get(20)).toEqual([
            { ki: 'B', quantity: 2, status: 5, transferType: 0, retireReason: null, chzSent: false },
        ]);
    });

    it('большие наборы ограничены 100 идентификаторами; пустые и выключенная маркировка не вызывают SQL', async () => {
        const service = new Trade2006ReturnStockService(null, new ConfigService({ MARK_CODES_ENABLED: true }));
        const t = { query: jest.fn(async (_sql: string, _args: number[], _auto: boolean) => []) };
        const ids = Array.from({ length: 201 }, (_, i) => i + 1);
        await service.getLinesMany([...ids, ...ids], t as any);
        await service.getLineCodesMany([...ids, ...ids], t as any);
        expect(t.query.mock.calls.map((c) => c[1].length)).toEqual([100, 100, 1, 100, 100, 1]);
        t.query.mockClear();
        await service.getLinesMany([], t as any);
        await service.getLineCodesMany([], t as any);
        const disabled = new Trade2006ReturnStockService(null, new ConfigService({ MARK_CODES_ENABLED: false }));
        expect(await disabled.getLineCodesMany(ids, t as any)).toEqual(new Map());
        expect(t.query).not.toHaveBeenCalled();
    });
});
