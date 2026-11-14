import { Logger } from '@nestjs/common';
import { setup } from '../../../test/fixtures/ozon-incoming-promos.fixture';

beforeAll(() => Logger.overrideLogger(false));

it('первый приход → акция → два повтора и рестарт: одна отправка normal и одно уведомление', async () => {
    const s = setup();
    expect(await s.run()).toEqual([{ offerId: s.offer }]);
    const after = { ...s.live };
    expect(after.price).toBeLessThan(Number(s.target().price));
    expect(after.marketing_seller_price).toBeGreaterThanOrEqual(Number(s.target().min_price));
    expect(s.pricing.updatePrices).toHaveBeenCalledTimes(1);
    expect(s.api.update).toHaveBeenCalledTimes(1);
    expect(s.events.emit).toHaveBeenCalledTimes(1);
    expect(await s.run()).toEqual([{ offerId: s.offer }]);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    expect(s.live).toEqual(after);
    expect(s.pricing.updatePrices).toHaveBeenCalledTimes(1);
    expect(s.api.update).toHaveBeenCalledTimes(1);
    expect(s.events.emit).toHaveBeenCalledTimes(1);
});
it('рост себестоимости заново меняет цены, после чего следующий повтор опять ничего не отправляет', async () => {
    const s = setup();
    await s.run();
    const before = s.live.marketing_seller_price;
    s.setCost(200);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    expect(s.live.marketing_seller_price).toBeGreaterThan(before);
    expect(s.live.min_price).toBe(Number(s.target().min_price));
    expect(s.live.marketing_seller_price).toBeGreaterThanOrEqual(s.live.min_price);
    expect(s.pricing.updatePrices).toHaveBeenCalledTimes(2);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    expect(s.pricing.updatePrices).toHaveBeenCalledTimes(2);
    expect(s.api.update).toHaveBeenCalledTimes(2);
});
it('API принял акцию, но цена не изменилась: приход остаётся незавершённым до чтения настоящей цены', async () => {
    const s = setup();
    s.setAcknowledgementOnly(true);
    const rows = await s.run();
    expect(rows[0].error).toContain('не подтвердил итоговую');
    s.setAcknowledgementOnly(false);
    expect(await s.restart().run()).toEqual([{ offerId: s.offer }]);
    // После отказа не отправляем normal ещё раз: она уже подтверждена.
    expect(s.pricing.updatePrices).toHaveBeenCalledTimes(1);
    expect(s.api.update).toHaveBeenCalledTimes(2);
});
it('сбой чтения акций не позволяет вслепую заменить акционную цену обычной', async () => {
    const s = setup();
    await s.run();
    s.api.listActions.mockRejectedValueOnce(Error('Ozon недоступен'));
    await expect(s.restart().run()).rejects.toThrow('Ozon недоступен');
    expect(s.pricing.updatePrices).toHaveBeenCalledTimes(1);
});
