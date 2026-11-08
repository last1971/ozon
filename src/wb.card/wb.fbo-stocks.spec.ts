import { WbCardService } from './wb.card.service';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';
const row = (quantity = 2, extra = {}) => ({ nmId: 10, chrtId: 20, warehouseId: -999999, quantity, ...extra });
function setup(items = [row()]) {
    const service = Object.create(WbCardService.prototype) as WbCardService;
    const cards = new Map([
        ['123-5', { nmID: 10 }],
        ['456', { nmID: 11 }],
    ]);
    jest.spyOn(service, 'getWbCard').mockImplementation((offer) => (cards.get(offer) as any) ?? null);
    const loadCards = jest.spyOn(service, 'getAllWbCards').mockResolvedValue([] as any);
    const page = jest.fn().mockResolvedValue({ data: { items } });
    (service as any).readFboStockPage = page;
    return { service, cards, page, loadCards };
}
afterEach(() => {
    jest.restoreAllMocks();
    clearRateLimitCache();
});
it('суммирует размеры и склады по nmId, упаковки не умножает, путь не считает остатком', async () => {
    const s = setup([
        row(2, { inWayToClient: 80, inWayFromClient: 90 }),
        row(3, { warehouseId: 31 }),
        row(4, { chrtId: 21 }),
    ]);
    expect(await s.service.getFboStocks(['123-5', '456'])).toEqual(
        new Map([
            ['123-5', 9],
            ['456', 0],
        ]),
    );
    expect(s.page).toHaveBeenCalledWith(250000, 0);
    expect(s.loadCards).not.toHaveBeenCalled();
});
it('нет карточки — неизвестность, а не достоверный ноль', async () => {
    const s = setup([]);
    expect((await s.service.getFboStocks(['999'])).has('999')).toBe(false);
    expect(s.loadCards).toHaveBeenCalledTimes(1);
});
it.each([
    {},
    { data: {} },
    { data: { items: null } },
    { data: { items: [row(-1)] } },
    { data: { items: [row(NaN)] } },
    { data: { items: [row(2, { nmId: 0 })] } },
    { data: { items: [row(), row()] } },
])('повреждённый/дублирующий ответ не становится пустым складом: %j', async (response) => {
    const s = setup();
    s.page.mockResolvedValue(response);
    await expect(s.service.getFboStocks(['123-5'])).rejects.toThrow();
});
it('ошибка API не кэшируется как ноль; следующий запрос может успешно прочитать склад', async () => {
    const s = setup();
    s.page.mockRejectedValueOnce(Error('403'));
    await expect(s.service.getFboStocks(['123-5'])).rejects.toThrow('403');
    expect((await s.service.getFboStocks(['123-5'])).get('123-5')).toBe(2);
    expect(s.page).toHaveBeenCalledTimes(2);
});
it('одновременные чтения объединяются, данные обновляются после истечения кэша', async () => {
    const s = setup();
    const time = jest.spyOn(Date, 'now').mockReturnValue(1000000);
    const first = await Promise.all([s.service.getFboStocks(['123-5']), s.service.getFboStocks(['456'])]);
    expect(first[0].get('123-5')).toBe(2);
    expect(s.page).toHaveBeenCalledTimes(1);
    time.mockReturnValue(1060001);
    s.page.mockResolvedValue({ data: { items: [row(5)] } });
    expect((await s.service.getFboStocks(['123-5'])).get('123-5')).toBe(5);
    expect(s.page).toHaveBeenCalledTimes(2);
});
it('пагинация читает следующую страницу и не блокирует цикл событий', async () => {
    const s = setup();
    const items = Array.from({ length: 250000 }, (_, index) => row(0, { chrtId: index + 1 }));
    s.page
        .mockResolvedValueOnce({ data: { items } })
        .mockResolvedValueOnce({ data: { items: [row(3, { chrtId: 250001 })] } });
    let yielded = false;
    setImmediate(() => {
        yielded = true;
    });
    expect((await s.service.getFboStocks(['123-5'])).get('123-5')).toBe(3);
    expect(s.page).toHaveBeenNthCalledWith(2, 250000, 250000);
    expect(yielded).toBe(true);
});
it('пустой список не загружает ничего', async () => {
    const s = setup();
    expect((await s.service.getFboStocks([])).size).toBe(0);
    expect(s.page).not.toHaveBeenCalled();
});
it('использует существующий клиент WB и подтверждённый метод чтения', async () => {
    const service = Object.create(WbCardService.prototype);
    service.api = { method: jest.fn().mockResolvedValue({ data: { items: [] } }) };
    await service.readFboStockPage(250000, 0);
    expect(service.api.method).toHaveBeenCalledWith(
        'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses',
        'post',
        { limit: 250000, offset: 0 },
        true,
    );
});
