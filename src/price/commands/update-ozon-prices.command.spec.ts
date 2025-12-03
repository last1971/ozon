import { UpdateOzonPricesCommand } from './update-ozon-prices.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';
import { PriceDto } from '../dto/price.dto';

describe('UpdateOzonPricesCommand', () => {
    let command: UpdateOzonPricesCommand;
    let priceService: jest.Mocked<PriceService>;

    beforeEach(() => {
        priceService = {
            updatePrices: jest.fn(),
        } as any;
        command = new UpdateOzonPricesCommand(priceService);
    });

    it('should call update with mapped prices', async () => {
        priceService.updatePrices.mockResolvedValue({ result: [] });

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                {
                    offer_id: 'sku1',
                    min_price: 200,
                    price: 250,
                    old_price: 300,
                    sum_pack: 10,
                } as PriceDto,
            ],
        };

        await command.execute(context);

        expect(priceService.updatePrices).toHaveBeenCalledWith([
            {
                currency_code: 'RUB',
                min_price: '200',
                offer_id: 'sku1',
                old_price: '300',
                price: '250',
            },
        ]);
    });

    it('should handle multiple prices', async () => {
        priceService.updatePrices.mockResolvedValue({ result: [] });

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', min_price: 100, price: 150, old_price: 200, sum_pack: 5 } as PriceDto,
                { offer_id: 'sku2', min_price: 200, price: 250, old_price: 300, sum_pack: 10 } as PriceDto,
            ],
        };

        await command.execute(context);

        expect(priceService.updatePrices).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ offer_id: 'sku1' }),
                expect.objectContaining({ offer_id: 'sku2' }),
            ]),
        );
    });

    it('should not call update if ozonPrices is empty', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [],
        };

        await command.execute(context);

        expect(priceService.updatePrices).not.toHaveBeenCalled();
    });

    it('should not call update if ozonPrices is undefined', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
        };

        await command.execute(context);

        expect(priceService.updatePrices).not.toHaveBeenCalled();
    });

    it('should return context after updating', async () => {
        priceService.updatePrices.mockResolvedValue({ result: [] });

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', min_price: 200, price: 250, old_price: 300, sum_pack: 10 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result).toBe(context);
    });
});
