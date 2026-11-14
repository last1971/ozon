import { OzonLossPriceAdapter } from './ozon-loss-price.adapter';
import { WbLossPriceAdapter } from './wb-loss-price.adapter';
import { CollectSweepCommand } from '../../promos/price-lever/sweep/collect-sweep.command';
import { PromoSweepService } from '../../promos/price-lever/sweep/promo-sweep.service';
import { JobService } from '../../job/job.service';
import { emptyProgress } from '../../interfaces/i.job.context';
import { ozonPricesMatch } from '../../helpers/price/ozon-prices-match';
import { wbPriceTask } from '../../wb.price/wb-price-task';
const target = { currency_code: 'RUB', offer_id: '123', price: '250', old_price: '400', min_price: '200' };
describe('Адаптер Ozon', () => {
    const setup = () => {
        const pricing = { updatePrices: jest.fn().mockResolvedValue({ result: [{ offer_id: '123', updated: true }] }) };
        const products = {
            listAllOfferIds: jest.fn().mockResolvedValue(['123-1']),
            getPrices: jest.fn().mockResolvedValue({ items: [{ offer_id: '123', price: target }] }),
        };
        const promoPrices = { statesForPrices: jest.fn().mockResolvedValue([]) };
        const sweep = { start: jest.fn().mockReturnValue({ id: 'sweep' }) };
        const jobs = { whenDone: jest.fn().mockResolvedValue({ status: 'done', result: { checked: 1, items: [] } }) };
        return {
            pricing,
            products,
            promoPrices,
            sweep,
            jobs,
            adapter: new OzonLossPriceAdapter(pricing as any, products as any, sweep as any, jobs as any, promoPrices as any),
        };
    };
    it('сравнивает все три суммы без рублёвого допуска, отсутствие ответа не считается совпадением', async () => {
        const { adapter } = setup();
        expect(adapter.matches(target, { ...target, price: 250 })).toBe(true);
        expect(adapter.matches(target, { ...target, min_price: 199 })).toBe(false);
        expect(adapter.matches(target, null)).toBe(false);
        expect(ozonPricesMatch(target, { ...target, min_price: 199 })).toBe(true); // прежняя сверка сохраняет свой допуск
        expect(ozonPricesMatch(target, { ...target, price: undefined })).toBe(false);
    });
    it('отправляет через существующий сервис и различает результаты каждого товара', async () => {
        const s = setup();
        expect(await s.adapter.send([target, { ...target, offer_id: '456' }])).toEqual(
            new Map([
                ['123', null],
                ['456', { message: 'Ozon не подтвердил приём цены', kind: 'temporary' }],
            ]),
        );
        expect(s.pricing.updatePrices).toHaveBeenCalledWith([target, { ...target, offer_id: '456' }]);
    });
    it('акции вызывает той же цепочкой только по нужным товарам, ждёт результат', async () => {
        const s = setup();
        expect(await s.adapter.promos(['123'])).toEqual(new Map([['123', null]]));
        expect(s.sweep.start).toHaveBeenCalledWith(true, 'min', 'loss-queue', ['123']);
        s.jobs.whenDone.mockResolvedValueOnce({
            status: 'done',
            result: { checked: 1, items: [{ offerId: '123', ok: false, notes: ['Нет тарифа'] }] },
        } as any);
        expect((await s.adapter.promos(['123'])).get('123')).toEqual({ message: 'Нет тарифа', kind: 'data' });
        s.jobs.whenDone.mockResolvedValueOnce({ status: 'failed', error: 'API' } as any);
        await expect(s.adapter.promos(['123'])).rejects.toThrow('API');
        s.jobs.whenDone.mockResolvedValueOnce({ status: 'done', result: { checked: 0, items: [] } });
        await expect(s.adapter.promos(['123'])).rejects.toThrow('Неполная');
    });
    it('читает цены пакетами и не подменяет повреждённый ответ пустым', async () => {
        const s = setup();
        s.products.getPrices.mockImplementation(async (arg?: any) => ({
            items: arg.offer_id.map((offer_id: string) => ({ offer_id, price: target })),
        }));
        await s.adapter.current(Array.from({ length: 1001 }, (_, i) => String(i + 1)));
        expect(s.promoPrices.statesForPrices).toHaveBeenCalledTimes(1);
        expect(s.products.getPrices.mock.calls.map(([arg]) => arg.offer_id.length)).toEqual([1000, 1]);
        s.products.getPrices.mockResolvedValueOnce({ items: null });
        await expect(s.adapter.current(['123'])).rejects.toThrow('не вернул');
    });
});
describe('Адаптер ВБ', () => {
    const setup = () => {
        const pricing = {
            saveMinPrices: jest.fn().mockResolvedValue(undefined),
            updatePrices: jest.fn().mockResolvedValue({
                results: [
                    { offer_id: '123', status: 'accepted' },
                    { offer_id: '456', status: 'error', message: 'Ошибка ВБ' },
                ],
            }),
            setMinPrices: jest.fn().mockResolvedValue({ errors: [], missing: [], belowMin: [], changes: [] }),
        };
        const current = new Map([['123', { nmID: 1, price: 400, discount: 50, discountedPrice: 200 }]]);
        const prices = { getAll: jest.fn().mockResolvedValue(current) };
        return { pricing, prices, current, adapter: new WbLossPriceAdapter(pricing as any, prices as any) };
    };
    it('отправка и сравнение используют одно преобразование цены/скидки', async () => {
        const s = setup();
        expect(wbPriceTask(target, 1)).toEqual({ nmID: 1, price: 400, discount: 50 });
        expect(s.adapter.matches(target, s.current.get('123'))).toBe(true);
        expect(s.adapter.matches({ ...target, old_price: '401' }, s.current.get('123'))).toBe(false);
        await s.adapter.persist([target]);
        expect(s.pricing.saveMinPrices).toHaveBeenCalledWith([target]);
        expect(await s.adapter.send([target, { ...target, offer_id: '456' }])).toEqual(
            new Map([
                ['123', null],
                ['456', { message: 'Ошибка ВБ', kind: 'data' }],
            ]),
        );
    });
    it('проверяет скидку существующим сторожем и оставляет неподтверждённые изменения', async () => {
        const s = setup();
        await s.adapter.promos(['123']);
        expect(s.pricing.setMinPrices).toHaveBeenCalledWith(['123']);
        s.pricing.setMinPrices.mockResolvedValueOnce({
            errors: [],
            missing: [],
            belowMin: [],
            changes: [{ article: '123' }],
        } as any);
        expect((await s.adapter.promos(['123'])).get('123')).toEqual({
            message: expect.stringContaining('ожидается подтверждение'),
            kind: 'temporary',
        });
        s.pricing.setMinPrices.mockResolvedValueOnce({
            errors: ['123: ошибка акции'],
            missing: [],
            belowMin: [],
            changes: [],
        });
        expect((await s.adapter.promos(['123'])).get('123')).toEqual({
            message: '123: ошибка акции',
            kind: 'temporary',
        });
    });
});
it('ограниченный сбор переиспользует allStates с фильтром, полный сбор остаётся для прежних запусков', async () => {
    const price = { states: jest.fn().mockResolvedValue([]), allStates: jest.fn().mockResolvedValue([]) };
    const collect = new CollectSweepCommand(price as any);
    await collect.execute({ offerIds: ['123'], apply: true, goal: 'min', progress: emptyProgress() });
    expect(price.allStates).toHaveBeenCalledWith(['123']);
    expect(price.states).not.toHaveBeenCalled();
    await collect.execute({ apply: true, goal: 'min', progress: emptyProgress() });
    expect(price.allStates).toHaveBeenCalledTimes(2);
});
it('ограниченная сверка имеет отдельные параметры JobService и тот же порядок команд', async () => {
    const jobs = new JobService(),
        called: number[] = [];
    const commands = Array.from({ length: 6 }, (_, i) => ({
        execute: async (ctx) => {
            called.push(i);
            if (i === 4) ctx.report = { checked: ctx.offerIds.length };
            return ctx;
        },
    }));
    const service = new PromoSweepService(
        jobs,
        commands[0] as any,
        commands[1] as any,
        commands[2] as any,
        commands[3] as any,
        commands[4] as any,
        commands[5] as any,
    );
    const job = service.start(true, 'min', 'loss', ['123']);
    expect(job.params).toEqual({ apply: true, goal: 'min', offerIds: ['123'] });
    expect((await jobs.whenDone(job.id)).status).toBe('done');
    expect(called).toEqual([0, 1, 2, 3, 4, 5]);
});
