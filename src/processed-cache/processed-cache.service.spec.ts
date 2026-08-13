import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { ProcessedCacheService } from './processed-cache.service';

describe('ProcessedCacheService', () => {
    let service: ProcessedCacheService;
    const cacheGet = jest.fn();
    const cacheSet = jest.fn();

    beforeEach(async () => {
        cacheGet.mockReset().mockResolvedValue('');
        cacheSet.mockReset().mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProcessedCacheService,
                { provide: CACHE_MANAGER, useValue: { get: cacheGet, set: cacheSet } },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string, def?: any) => (key === 'CACHE_TTL_DAYS' ? 14 : def),
                    },
                },
            ],
        }).compile();

        service = module.get<ProcessedCacheService>(ProcessedCacheService);
    });

    describe('load', () => {
        it('пустой кеш → пустой Set', async () => {
            cacheGet.mockResolvedValueOnce('');
            const set = await service.load('orders', 'WbOrderService');
            expect(set).toEqual(new Set());
            expect(cacheGet).toHaveBeenCalledWith('processed:orders:WbOrderService');
        });

        it('CSV-строка → Set', async () => {
            cacheGet.mockResolvedValueOnce('a,b,c');
            const set = await service.load('orders', 'WbOrderService');
            expect(set).toEqual(new Set(['a', 'b', 'c']));
        });

        it('undefined из Redis → пустой Set (без падения)', async () => {
            cacheGet.mockResolvedValueOnce(undefined);
            const set = await service.load('orders', 'WbOrderService');
            expect(set).toEqual(new Set());
        });
    });

    describe('save', () => {
        it('пишет CSV под правильным ключом с TTL из CACHE_TTL_DAYS', async () => {
            await service.save('orders', 'WbOrderService', new Set(['a', 'b']));
            expect(cacheSet).toHaveBeenCalledWith(
                'processed:orders:WbOrderService',
                'a,b',
                14 * 24 * 60 * 60 * 1000,
            );
        });

        it('пустой Set → пишет пустую строку', async () => {
            await service.save('orders', 'WbOrderService', new Set());
            expect(cacheSet).toHaveBeenCalledWith('processed:orders:WbOrderService', '', expect.any(Number));
        });
    });

    describe('process', () => {
        const keyOf = (i: { posting_number: string }) => i.posting_number;

        it('пропускает уже обработанные, processor только для новых', async () => {
            cacheGet.mockResolvedValueOnce('002');
            const processor = jest.fn().mockResolvedValue(undefined);
            const flushers: (() => Promise<void>)[] = [];

            await service.process(
                'test',
                'TestService',
                [{ posting_number: '001' }, { posting_number: '002' }, { posting_number: '003' }],
                keyOf,
                processor,
                flushers,
            );

            expect(processor).toHaveBeenCalledTimes(2);
            expect(processor).toHaveBeenCalledWith({ posting_number: '001' });
            expect(processor).toHaveBeenCalledWith({ posting_number: '003' });
            expect(processor).not.toHaveBeenCalledWith({ posting_number: '002' });
        });

        it('запись в кеш отложена до выполнения flusher', async () => {
            cacheGet.mockResolvedValueOnce('002');
            const flushers: (() => Promise<void>)[] = [];

            await service.process(
                'test',
                'TestService',
                [{ posting_number: '001' }, { posting_number: '003' }],
                keyOf,
                jest.fn().mockResolvedValue(undefined),
                flushers,
            );

            // пока flusher не вызван — в Redis ничего не писали
            expect(cacheSet).not.toHaveBeenCalled();
            expect(flushers).toHaveLength(1);

            await flushers[0]();

            expect(cacheSet).toHaveBeenCalledTimes(1);
            const [key, savedString, ttl] = cacheSet.mock.calls[0];
            expect(key).toBe('processed:test:TestService');
            expect(savedString.split(',').sort()).toEqual(['001', '002', '003']);
            expect(ttl).toBe(14 * 24 * 60 * 60 * 1000);
        });

        it('упавший элемент не помечается обработанным и не рушит остальные', async () => {
            // Прежний контракт (ошибка пробрасывалась наружу) отменён итерацией 3:
            // упавшее отправление обязано попасть в следующий прогон, а соседние —
            // доработать. Плюс раньше упавший элемент помечался обработанным и
            // не обрабатывался больше никогда: ключ живёт CACHE_TTL_DAYS.
            const processor = jest
                .fn()
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValueOnce(undefined);
            const flushers: (() => Promise<void>)[] = [];

            const res = await service.process(
                'test',
                'TestService',
                [{ posting_number: '001' }, { posting_number: '002' }],
                keyOf,
                processor,
                flushers,
            );

            expect(processor).toHaveBeenCalledTimes(2);
            expect(res.done).toBe(1);
            expect(res.failed).toEqual(['001: boom']);

            await flushers[0]();
            // сохранён только успешный ключ
            expect(cacheSet).toHaveBeenCalledWith(expect.any(String), '002', expect.any(Number));
        });
    });
});
