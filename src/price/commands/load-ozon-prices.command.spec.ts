import { LoadOzonPricesCommand } from './load-ozon-prices.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';
import { PriceDto } from '../dto/price.dto';

describe('LoadOzonPricesCommand', () => {
    let command: LoadOzonPricesCommand;
    let priceService: jest.Mocked<PriceService>;

    beforeEach(() => {
        priceService = {
            getOzonPrices: jest.fn(),
        } as any;
        command = new LoadOzonPricesCommand(priceService);
    });

    it('should load prices for ozonSkus into context', async () => {
        const mockPrices: PriceDto[] = [
            { offer_id: 'sku1', name: 'Product 1' } as PriceDto,
            { offer_id: 'sku2', name: 'Product 2' } as PriceDto,
        ];
        priceService.getOzonPrices.mockResolvedValue(mockPrices);

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonSkus: ['sku1', 'sku2'],
        };

        const result = await command.execute(context);

        expect(priceService.getOzonPrices).toHaveBeenCalledWith(['sku1', 'sku2']);
        expect(result.ozonPrices).toEqual(mockPrices);
    });

    it('should handle empty ozonSkus', async () => {
        priceService.getOzonPrices.mockResolvedValue([]);

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonSkus: [],
        };

        const result = await command.execute(context);

        expect(priceService.getOzonPrices).toHaveBeenCalledWith([]);
        expect(result.ozonPrices).toEqual([]);
    });

    it('should handle undefined ozonSkus', async () => {
        priceService.getOzonPrices.mockResolvedValue([]);

        const context: IGoodsProcessingContext = {
            skus: [],
        };

        const result = await command.execute(context);

        expect(priceService.getOzonPrices).toHaveBeenCalledWith([]);
        expect(result.ozonPrices).toEqual([]);
    });
});
