import { ConfigService } from '@nestjs/config';
import { JobService } from '../job/job.service';
import { OzonReturnService } from './ozon.return.service';

describe('Ручной пересчёт Ozon через существующий JobService', () => {
    it('возвращает id до конца работы, объединяет повтор и cron, сохраняет один снимок', async () => {
        const jobs = new JobService();
        let release: (offers: string[]) => void;
        const products = {
            listAllOfferIds: jest.fn(
                () =>
                    new Promise<string[]>((resolve) => {
                        release = resolve;
                    }),
            ),
            infoList: jest.fn().mockResolvedValue([{ sku: '123-1', marketSku: 1, typeId: 1 }]),
        };
        const store = {
            listKnownOffers: jest.fn().mockResolvedValue([]),
            replace: jest.fn().mockResolvedValue(undefined),
        };
        const service = new OzonReturnService(
            { get: (_, fallback) => fallback } as ConfigService,
            products as any,
            {
                preview: async () => ({
                    issues: [],
                    rows: [{ offerId: '123-1', soldUnits: 3, paidReturnUnits: 3, returnPerc: 1 }],
                }),
            } as any,
            store as any,
            { listRecordedWriteOffs: async () => [] } as any,
            jobs,
            {
                loading: [],
                calculate: {
                    execute: async (c) => {
                        c.expenses = new Map();
                        return c;
                    },
                },
            } as any,
        );
        const now = new Date('2026-11-07T09:00:00Z');
        const first = service.start('browser-1', now);
        const second = service.start('browser-2', now);
        const cron = service.recalculate(now);
        expect(first.id).toBe(second.id);
        expect(first.clientId).toBe('browser-1');
        expect(first.status).toBe('running');
        expect(first.kind).toBe('loss-recalculate:ozon');
        while (!release) await new Promise<void>((resolve) => setImmediate(resolve));
        expect(store.replace).not.toHaveBeenCalled();
        release(['123-1']);
        await expect(cron).resolves.toEqual({ rows: 1, from: '2026-08-09', to: '2026-11-07' });
        const done = await jobs.whenDone(first.id);
        expect(done.status).toBe('done');
        expect(done.progress.percent).toBe(100);
        expect(store.replace).toHaveBeenCalledTimes(1);
        expect(store.replace.mock.calls[0][0].rows[0]).toMatchObject({ returnRate: 1 });
    });
});
