import { ProductService } from './product.service';

const setup = () => {
    const method = jest.fn();
    return { method, service: new ProductService({ method } as any, null, null) };
};
const page = (offers: string[], last_id = '', total?: number) => ({
    result: { items: offers.map((offer_id) => ({ offer_id })), last_id, total },
});
describe('Полный каталог для проверки комиссий', () => {
    it('возвращает все страницы и сообщает прогресс', async () => {
        const { method, service } = setup();
        const progress = jest.fn();
        method.mockResolvedValueOnce(page(['one', 'two'], 'next', 3)).mockResolvedValueOnce(page(['three'], '', 3));
        expect(await service.listAllOfferIds(progress)).toEqual(['one', 'two', 'three']);
        expect(method.mock.calls[1][1].last_id).toBe('next');
        expect(progress.mock.calls).toEqual([[2], [3]]);
    });
    it.each([undefined, { result: null }, { result: { items: null } }])(
        'ошибка второй страницы %j не возвращает частичный каталог',
        async (response) => {
            const { method, service } = setup();
            method.mockResolvedValueOnce(page(['one'], 'next')).mockResolvedValueOnce(response);
            await expect(service.listAllOfferIds()).rejects.toThrow('полный каталог');
        },
    );
    it('не принимает преждевременный конец списка', async () => {
        const { method, service } = setup();
        method.mockResolvedValue(page(['one'], '', 2));
        await expect(service.listAllOfferIds()).rejects.toThrow('неполный каталог');
    });
    it('повтор курсора не запускает бесконечную загрузку', async () => {
        const { method, service } = setup();
        method.mockResolvedValueOnce(page(['one'], 'same')).mockResolvedValueOnce(page(['two'], 'same'));
        await expect(service.listAllOfferIds()).rejects.toThrow('Повтор страницы');
        expect(method).toHaveBeenCalledTimes(2);
    });
    it.each([['one', 'one'], ['']].map((offers) => [offers]))(
        'не пропускает некорректные артикулы %j',
        async (offers) => {
            const { method, service } = setup();
            method.mockResolvedValue(page(offers));
            await expect(service.listAllOfferIds()).rejects.toThrow('артикул');
        },
    );
    it('обнаруживает изменение каталога между страницами', async () => {
        const { method, service } = setup();
        method.mockResolvedValueOnce(page(['one'], 'next', 2)).mockResolvedValueOnce(page(['two'], '', 3));
        await expect(service.listAllOfferIds()).rejects.toThrow('Количество товаров');
    });
    it('ограничение страниц не выдаёт частичный результат за полный', async () => {
        const { method, service } = setup();
        let n = 0;
        method.mockImplementation(async () => page([`sku-${++n}`], `cursor-${n}`));
        await expect(service.listAllOfferIds()).rejects.toThrow('лимит страниц');
        expect(method).toHaveBeenCalledTimes(100);
    });
    it('корректный пустой ответ возвращает пустой список для проверки вызывающим кодом', async () => {
        const { method, service } = setup();
        method.mockResolvedValue(page([], '', 0));
        expect(await service.listAllOfferIds()).toEqual([]);
    });
});
