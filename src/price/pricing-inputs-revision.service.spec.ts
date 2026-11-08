import { PricingInputsRevisionService } from './pricing-inputs-revision.service';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
it('снимок потерь отменяет план только своей площадки и фасовки', () => {
    const service = new PricingInputsRevisionService();
    const own = priceUpdateQueue.capture('ozon', ['99101']),
        other = priceUpdateQueue.capture('wb', ['99101']),
        pack = priceUpdateQueue.capture('ozon', ['99101-10']);
    service.lossSaved('OZON', ['99101-1']);
    expect(() => priceUpdateQueue.assertCurrent(own)).toThrow('устарел');
    expect(() => priceUpdateQueue.assertCurrent(other)).not.toThrow();
    expect(() => priceUpdateQueue.assertCurrent(pack)).not.toThrow();
});
it('приход отменяет планы своего кода для обеих площадок и фасовок', () => {
    const service = new PricingInputsRevisionService();
    const snapshots = ['ozon', 'wb'].flatMap((key) =>
        ['99102', '99102-10'].map((offer) => priceUpdateQueue.capture(key, [offer])),
    );
    service.countsChanged([{ code: 99102 }]);
    snapshots.forEach((snapshot) => expect(() => priceUpdateQueue.assertCurrent(snapshot)).toThrow('устарел'));
});
