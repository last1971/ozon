import { LoadMarketOffersCommand } from './load-market-offers.command';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { emptyProgress } from '../../interfaces/i.job.context';

describe('LoadMarketOffersCommand', () => {
    it('зовёт listOffers маркетплейса с прогрессом → ctx.offers', async () => {
        const offers = [{ offer: '1-10', goodscode: '1', name: 'x' }];
        const listOffers = jest.fn().mockResolvedValue(offers);
        const progress = emptyProgress();

        const res = await new LoadMarketOffersCommand().execute({ progress, market: GoodServiceEnum.WB, service: { listOffers } as any });

        expect(listOffers).toHaveBeenCalledWith(progress);
        expect(res.offers).toBe(offers);
    });
});
