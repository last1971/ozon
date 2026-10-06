import { OzonGtinService } from './ozon.gtin.service';
import { GtinCheckItem } from '../interfaces/i.gtin.sync';

describe('OzonGtinService.update', () => {
    const addBarcodes = jest.fn();
    const evictProductAttributes = jest.fn();
    const service = new OzonGtinService({ addBarcodes, evictProductAttributes } as any);

    const item = (offer: string, sku: number, gtins: number): GtinCheckItem =>
        ({
            offer,
            goodscode: offer,
            marketId: sku,
            add: Array.from({ length: gtins }, (_, i) => `0460${offer}${i}`),
        }) as any;

    beforeEach(() => {
        addBarcodes.mockReset().mockResolvedValue({ errors: [] });
        evictProductAttributes.mockReset();
    });

    it('в запросе не больше 100 штрихкодов, карточка между запросами не делится', async () => {
        // 60 карточек по 2 GTIN = 120 штрихкодов: 100 карточек в одном запросе Озон отбивал целиком
        const items = Array.from({ length: 60 }, (_, i) => item(String(1000 + i), i + 1, 2));

        const res = await service.update(items);

        expect(addBarcodes).toHaveBeenCalledTimes(2);
        const sizes = addBarcodes.mock.calls.map(([entries]) => entries.length);
        expect(sizes).toEqual([100, 20]);
        for (const [entries] of addBarcodes.mock.calls) {
            const skus = new Set(entries.map((e) => e.sku));
            for (const sku of skus) expect(entries.filter((e) => e.sku === sku)).toHaveLength(2);
        }
        expect(res.every((r) => r && !r.error)).toBe(true);
    });

    it('отказ одного запроса ложится только на его карточки', async () => {
        const items = [item('1', 1, 60), item('2', 2, 60)];
        addBarcodes.mockResolvedValueOnce({ result: null, error: { message: 'boom' } }).mockResolvedValueOnce({
            errors: [],
        });

        const res = await service.update(items);

        expect(addBarcodes).toHaveBeenCalledTimes(2);
        expect(res[0].error).toContain('boom');
        expect(res[1].error).toBeUndefined();
    });
});

describe('OzonGtinService.check — фасовки Озона уходят в канал файла, не в API', () => {
    it('держатель — в items (API), фасовка — в forFile с GTIN держателя и SKU', async () => {
        const listAllOfferIds = jest.fn().mockResolvedValue(['548580', '548580-10']);
        const infoList = jest.fn().mockResolvedValue([
            { sku: '548580', marketSku: 1, barcodes: ['OZN1'], remark: 'Клеммы' },
            { sku: '548580-10', marketSku: 2, barcodes: ['OZN2'], remark: 'Клеммы, 10 шт.' },
        ]);
        const service = new OzonGtinService({ listAllOfferIds, infoList } as any);

        const res = await service.check([{ goodscode: '548580', gtins: ['00400001819968'] }]);

        expect(res.items).toHaveLength(1);
        expect(res.items[0]).toMatchObject({
            offer: '548580',
            slot: 'barcodes',
            ok: false,
            add: ['00400001819968'],
            marketId: 1,
        });
        expect(res.forFile).toHaveLength(1);
        expect(res.forFile[0]).toMatchObject({
            offer: '548580-10',
            slot: 'extra',
            ok: false,
            add: ['00400001819968'],
            marketId: 2,
        });
    });
});
