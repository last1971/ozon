import { Logger } from '@nestjs/common';
import { setup } from '../../../test/fixtures/ozon-incoming-promos.fixture';
import { limitPrice } from '../../promos/price-lever/promo-price.planner';

beforeAll(() => Logger.overrideLogger(false));

it('приход: предельная по правилу одним импортом, покупатель на минимальной; повторы и рестарт ничего не шлют', async () => {
    const s = setup();
    expect(s.target()).toMatchObject({ price: '699', min_price: '279', old_price: '837' });
    expect(await s.run()).toEqual([{ offerId: s.offer }]);
    expect(s.live).toEqual({ price: limitPrice(279, 5), min_price: 279, old_price: 837, marketing_seller_price: 279 });
    expect(s.products.setPrice).toHaveBeenCalledTimes(1);
    expect(await s.run()).toEqual([{ offerId: s.offer }]);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    expect(s.products.setPrice).toHaveBeenCalledTimes(1);
});

it('рост себестоимости: новая минимальная и предельная, следующий повтор опять ничего не отправляет', async () => {
    const s = setup();
    await s.run();
    s.setCost(200);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    const min = Number(s.target().min_price);
    expect(s.live).toMatchObject({ price: limitPrice(min, 5), min_price: min });
    expect(s.live.marketing_seller_price).toBeGreaterThanOrEqual(min);
    expect(s.products.setPrice).toHaveBeenCalledTimes(2);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    expect(s.products.setPrice).toHaveBeenCalledTimes(2);
});

it('Ozon принял импорт, но цена не изменилась: приход не закрыт, следующий проход шлёт снова', async () => {
    const s = setup();
    s.setAcknowledgementOnly(true);
    expect((await s.run())[0].error).toMatch(/правилу|подтверд/i);
    s.setAcknowledgementOnly(false);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    expect(s.live.marketing_seller_price).toBe(279);
    expect(s.products.setPrice).toHaveBeenCalledTimes(2);
});

it('нашу акцию выключили и включили: цена не уходит ниже минимальной и не переотправляется', async () => {
    const s = setup();
    await s.run();
    s.setSellerOn(false);
    expect(s.live.marketing_seller_price).toBe(limitPrice(279, 5));
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    s.setSellerOn(true);
    expect(s.live.marketing_seller_price).toBe(279);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    expect(s.products.setPrice).toHaveBeenCalledTimes(1);
});

it('сбой чтения нашей акции не даёт отправить цену вслепую', async () => {
    const s = setup();
    await s.run();
    s.setCost(200);
    const app = s.restart();
    s.sellerApi.currentAction.mockRejectedValueOnce(Error('Ozon недоступен'));
    await expect(app.run()).rejects.toThrow('Ozon недоступен');
    expect(s.products.setPrice).toHaveBeenCalledTimes(1);
});
