import { WbPriceService } from './wb.price.service';
const make = () => {
    const getAll = jest.fn().mockResolvedValue(new Map([['a', { nmID: 1, price: 1000, discount: 50 }]]));
    const method = jest.fn().mockResolvedValue({ data: { id: 123 }, error: false });
    const cards = { getNmID: jest.fn((offer) => (offer === 'a' ? '1' : offer === 'b' ? '2' : undefined)) };
    const goods = { getWbData: jest.fn().mockResolvedValue([]), setWbData: jest.fn() };
    const service = new WbPriceService(
        null,
        goods as any,
        { method } as any,
        cards as any,
        null,
        { getAll } as any,
        { load: async () => new Map() } as any,
    );
    return { service, method, getAll, goods };
};
const row = (offer_id: string, price = '500') => ({
    offer_id,
    price,
    old_price: '1000',
    min_price: price,
    currency_code: 'RUB',
});
describe('WB: одинаковые цены и результат отправки', () => {
    it('совпавшие цена и скидка не отправляются; изменившиеся отправляются', async () => {
        const m = make();
        const result = await m.service.updatePrices([row('a'), row('b')]);
        expect(m.method).toHaveBeenCalledTimes(1);
        expect(m.method.mock.calls[0][2]).toEqual({ data: [{ nmID: 2, price: 1000, discount: 50 }] });
        expect(result.results).toEqual([
            { offer_id: 'a', nmID: 1, status: 'unchanged' },
            { offer_id: 'b', nmID: 2, status: 'accepted' },
        ]);
    });
    it('пустой запрос и полное совпадение не создают задач WB', async () => {
        const m = make();
        await m.service.updatePrices([]);
        await m.service.updatePrices([row('a')]);
        expect(m.method).not.toHaveBeenCalled();
    });
    it('нет карточки — не отправляет nmID:null; сообщает артикул', async () => {
        const m = make();
        const result = await m.service.updatePrices([row('missing')]);
        expect(m.method).not.toHaveBeenCalled();
        expect(result.error).toBe(true);
        expect(result.results[0]).toMatchObject({ offer_id: 'missing', status: 'error' });
    });
    it('already set после чтения — без ошибки и без повтора; другая ошибка сохраняется', async () => {
        const m = make();
        m.method.mockResolvedValueOnce({ unchanged: true, error: false });
        expect(await m.service.updatePrices([row('b')])).toMatchObject({
            error: false,
            results: [{ offer_id: 'b', status: 'unchanged' }],
        });
        expect(m.method).toHaveBeenCalledTimes(1);
        m.method.mockResolvedValueOnce({ error: { data: { errorText: 'Invalid data format' } } });
        expect(await m.service.updatePrices([row('b')])).toMatchObject({
            error: true,
            results: [{ offer_id: 'b', status: 'error', message: 'Invalid data format' }],
        });
    });
    it('ошибка чтения текущих цен не превращается в пустой кабинет и отправку вслепую', async () => {
        const m = make();
        m.getAll.mockRejectedValue(new Error('429'));
        await expect(m.service.updatePrices([row('b')])).rejects.toThrow('429');
        expect(m.method).not.toHaveBeenCalled();
    });
});
