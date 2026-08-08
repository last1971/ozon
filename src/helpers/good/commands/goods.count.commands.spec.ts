import { IGoodsCountContext } from './i.goods.count.context';
import { GoodServiceEnum } from '../../../good/good.service.enum';
import { MapSkusToGoodsCommand } from './map-skus-to-goods.command';
import { DistributePlainCountsCommand } from './distribute-plain-counts.command';
import { DistributeMarkedCountsCommand } from './distribute-marked-counts.command';
import { ApplyDisabledCommand } from './apply-disabled.command';
import { KeepChangedOnlyCommand } from './keep-changed-only.command';
import { PushCountsCommand } from './push-counts.command';

const context = (over: Partial<IGoodsCountContext> = {}): IGoodsCountContext =>
    ({
        serviceKey: GoodServiceEnum.OZON,
        service: { skuList: [], updateGoodCounts: jest.fn() } as any,
        goods: [],
        disabled: new Set<string>(),
        markedGoods: new Set<string>(),
        freeByGood: new Map(),
        reservedByGood: new Map(),
        filteredSkuMap: new Map(),
        counts: new Map<string, number>(),
        updated: 0,
        ...over,
    }) as IGoodsCountContext;

describe('MapSkusToGoodsCommand', () => {
    it('раскладывает SKU сервиса по товарам', async () => {
        const result = await new MapSkusToGoodsCommand().execute(
            context({
                service: { skuList: ['498824', '498824-100', '111'] } as any,
                goods: [{ code: '498824', quantity: 1, reserve: 0, name: 'x' }] as any,
            }),
        );

        expect(result.filteredSkuMap).toEqual(new Map([['498824', ['498824', '498824-100']]]));
    });
});

describe('DistributePlainCountsCommand', () => {
    it('немаркируемый товар делится пропорционально коэффициентам', async () => {
        const result = await new DistributePlainCountsCommand().execute(
            context({
                goods: [{ code: 'sku', quantity: 100, reserve: 0, name: 'x' }] as any,
                filteredSkuMap: new Map([['sku', ['sku-1', 'sku-2', 'sku-3']]]),
            }),
        );

        expect(result.counts).toEqual(new Map([['sku-1', 17], ['sku-2', 16], ['sku-3', 17]]));
    });

    it('маркируемый товар пропускается — его считает другая команда', async () => {
        const result = await new DistributePlainCountsCommand().execute(
            context({
                goods: [{ code: '498824', quantity: 100, reserve: 0, name: 'x' }] as any,
                filteredSkuMap: new Map([['498824', ['498824']]]),
                markedGoods: new Set(['498824']),
            }),
        );

        expect(result.counts.size).toBe(0);
    });

    it('резерв вычитается из остатка', async () => {
        const result = await new DistributePlainCountsCommand().execute(
            context({
                goods: [{ code: 'sku', quantity: 100, reserve: 40 }] as any,
                filteredSkuMap: new Map([['sku', ['sku-1']]]),
            }),
        );

        expect(result.counts).toEqual(new Map([['sku-1', 60]]));
    });
});

describe('DistributeMarkedCountsCommand', () => {
    it('заказ на 24 штуки закрывается кодом на 100 — единичных не хватает', async () => {
        const result = await new DistributeMarkedCountsCommand().execute(
            context({
                goods: [{ code: '498824', quantity: 8416, reserve: 24, name: 'x' }] as any,
                filteredSkuMap: new Map([['498824', ['498824', '498824-100', '498824-800']]]),
                markedGoods: new Set(['498824']),
                freeByGood: new Map([['498824', new Map([[1, 16], [100, 12], [800, 9]])]]),
                reservedByGood: new Map([['498824', [24]]]),
            }),
        );

        expect(result.counts).toEqual(
            new Map([['498824', 16], ['498824-100', 11], ['498824-800', 9]]),
        );
    });

    it('552601: три заказа 1+3+3 не трогают коробки на 12', async () => {
        const result = await new DistributeMarkedCountsCommand().execute(
            context({
                goods: [{ code: '552601', quantity: 1352, reserve: 7, name: 'x' }] as any,
                filteredSkuMap: new Map([['552601', ['552601', '552601-3', '552601-12']]]),
                markedGoods: new Set(['552601']),
                freeByGood: new Map([['552601', new Map([[1, 2], [3, 9], [6, 4], [12, 2], [40, 32]]) ]]),
                reservedByGood: new Map([['552601', [1, 3, 3]]]),
            }),
        );

        // 1 штучный + 32×40 и 4×6 без своих фасовок = 1 + 1280 + 24 = 1305
        expect(result.counts).toEqual(
            new Map([['552601', 1305], ['552601-3', 7], ['552601-12', 2]]),
        );
    });

    it('свободных кодов нет — все фасовки в 0', async () => {
        const result = await new DistributeMarkedCountsCommand().execute(
            context({
                goods: [{ code: '569126', quantity: 1066, reserve: 0, name: 'x' }] as any,
                filteredSkuMap: new Map([['569126', ['569126', '569126-10']]]),
                markedGoods: new Set(['569126']),
                freeByGood: new Map(),
                reservedByGood: new Map(),
            }),
        );

        expect(result.counts).toEqual(new Map([['569126', 0], ['569126-10', 0]]));
    });

    it('кодов больше, чем на складе — считаем по кодам и пишем предупреждение', async () => {
        const command = new DistributeMarkedCountsCommand();
        const warn = jest.spyOn(command['logger'], 'warn').mockImplementation(() => undefined);

        const result = await command.execute(
            context({
                goods: [{ code: '552601', quantity: 1352, reserve: 0, name: 'x' }] as any,
                filteredSkuMap: new Map([['552601', ['552601']]]),
                markedGoods: new Set(['552601']),
                freeByGood: new Map([['552601', new Map([[1, 1357]])]]),
            }),
        );

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('расхождение 5 шт'));
        // учёт остаток не режет: продать можно ровно то, на что есть коды
        expect(result.counts).toEqual(new Map([['552601', 1357]]));
    });

    it('немаркированный товар не трогает', async () => {
        const result = await new DistributeMarkedCountsCommand().execute(
            context({
                goods: [{ code: 'sku', quantity: 10, reserve: 0 }] as any,
                filteredSkuMap: new Map([['sku', ['sku-1']]]),
            }),
        );

        expect(result.counts.size).toBe(0);
    });
});

describe('ApplyDisabledCommand', () => {
    it('sku-блок гасит только свою фасовку', async () => {
        const result = await new ApplyDisabledCommand().execute(
            context({
                counts: new Map([['sku-1', 17], ['sku-2', 16]]),
                disabled: new Set(['sku-2']),
            }),
        );

        expect(result.counts).toEqual(new Map([['sku-1', 17], ['sku-2', 0]]));
    });

    it('good-блок гасит все фасовки товара', async () => {
        const result = await new ApplyDisabledCommand().execute(
            context({
                counts: new Map([['sku-1', 17], ['sku-2', 16]]),
                disabled: new Set(['good:sku']),
            }),
        );

        expect(result.counts).toEqual(new Map([['sku-1', 0], ['sku-2', 0]]));
    });

    it('отключений нет — контекст не меняется', async () => {
        const ctx = context({ counts: new Map([['sku-1', 5]]) });
        const result = await new ApplyDisabledCommand().execute(ctx);

        expect(result).toBe(ctx);
    });
});

describe('KeepChangedOnlyCommand', () => {
    it('оставляет только изменившиеся SKU', async () => {
        const result = await new KeepChangedOnlyCommand().execute(
            context({
                counts: new Map([['sku-1', 5], ['sku-2', 7]]),
                currentCounts: new Map([['sku-1', 5], ['sku-2', 3]]),
            }),
        );

        expect(result.counts).toEqual(new Map([['sku-2', 7]]));
    });

    it('SKU маркета, которого нет в расчёте, обнуляется', async () => {
        const result = await new KeepChangedOnlyCommand().execute(
            context({
                counts: new Map(),
                currentCounts: new Map([['hz', 4]]),
            }),
        );

        expect(result.counts).toEqual(new Map([['hz', 0]]));
    });

    it('событийный путь (currentCounts нет) проходит насквозь', async () => {
        const ctx = context({ counts: new Map([['sku-1', 5]]) });
        const result = await new KeepChangedOnlyCommand().execute(ctx);

        expect(result).toBe(ctx);
    });
});

describe('PushCountsCommand', () => {
    it('шлёт остатки на маркет и запоминает счётчик', async () => {
        const updateGoodCounts = jest.fn().mockResolvedValue(2);
        const command = new PushCountsCommand();
        jest.spyOn(command['logger'], 'log').mockImplementation(() => undefined);

        const result = await command.execute(
            context({
                service: { skuList: [], updateGoodCounts } as any,
                counts: new Map([['sku-1', 5], ['sku-2', 0]]),
            }),
        );

        expect(updateGoodCounts).toHaveBeenCalledWith(new Map([['sku-1', 5], ['sku-2', 0]]));
        expect(result.updated).toBe(2);
    });

    it('нечего слать — на маркет не ходим', async () => {
        const updateGoodCounts = jest.fn();

        const result = await new PushCountsCommand().execute(
            context({ service: { skuList: [], updateGoodCounts } as any, counts: new Map() }),
        );

        expect(updateGoodCounts).not.toHaveBeenCalled();
        expect(result.updated).toBe(0);
    });
});
