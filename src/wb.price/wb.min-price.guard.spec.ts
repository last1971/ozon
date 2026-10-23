import { GoodServiceEnum } from '../good/good.service.enum';
import { WB_MIN_PRICES_EVENT, WbMinPriceGuard } from './wb.min-price.guard';

describe('WbMinPriceGuard — крон «ВБ к минимальной»', () => {
    const setMinPrices = jest.fn();
    const emit = jest.fn();
    const guard = (services: GoodServiceEnum[] = [GoodServiceEnum.WB]) =>
        new WbMinPriceGuard({ setMinPrices } as any, { get: () => services } as any, { emit } as any);
    const report = (over: any = {}) => ({ toUpdate: 0, belowMin: [], errors: [], changes: [], uploadId: null, ...over });
    beforeEach(() => [setMinPrices, emit].forEach((m) => m.mockReset()));

    it('зовёт ручку по всем карточкам; поменял — событие с отчётом', async () => {
        const r = report({ toUpdate: 2, uploadId: 'u1' });
        setMinPrices.mockResolvedValue(r);
        await guard().run();
        expect(setMinPrices).toHaveBeenCalledWith([]);
        expect(emit).toHaveBeenCalledWith(WB_MIN_PRICES_EVENT, r);
    });

    it('менять нечего — молчим (ошибки «нет минимальной» повторялись бы каждый прогон)', async () => {
        setMinPrices.mockResolvedValue(report({ errors: ['A: нет min_price в Firebird'] }));
        await guard().run();
        expect(emit).not.toHaveBeenCalled();
    });

    it('ВБ на узле выключен — не ходим', async () => {
        await guard([GoodServiceEnum.OZON]).run();
        expect(setMinPrices).not.toHaveBeenCalled();
    });

    it('прошлый прогон ещё идёт — второй не стартует; ошибка не роняет крон', async () => {
        let release: () => void = () => undefined;
        setMinPrices.mockImplementationOnce(() => new Promise((res) => (release = () => res(report()))));
        const g = guard();
        const first = g.run();
        await g.run();
        expect(setMinPrices).toHaveBeenCalledTimes(1);
        release();
        await first;
        setMinPrices.mockRejectedValueOnce(new Error('429'));
        await expect(g.run()).resolves.toBeUndefined();
    });
});
