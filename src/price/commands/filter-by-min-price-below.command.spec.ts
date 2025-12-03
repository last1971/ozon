import { FilterByMinPriceBelowCommand } from './filter-by-min-price-below.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceDto } from '../dto/price.dto';

describe('FilterByMinPriceBelowCommand', () => {
    let command: FilterByMinPriceBelowCommand;

    beforeEach(() => {
        command = new FilterByMinPriceBelowCommand();
    });

    it('should filter prices where min_price <= threshold', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', min_price: 200, price: 250 } as PriceDto,
                { offer_id: 'sku2', min_price: 300, price: 350 } as PriceDto,
                { offer_id: 'sku3', min_price: 350, price: 400 } as PriceDto,
            ],
            priceThreshold: 300,
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(2);
        expect(result.ozonPrices.map(p => p.offer_id)).toEqual(['sku1', 'sku2']);
    });

    it('should save items with price > threshold to ozonPricesHighPrice', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', min_price: 200, price: 250 } as PriceDto,
                { offer_id: 'sku2', min_price: 280, price: 350 } as PriceDto,
                { offer_id: 'sku3', min_price: 290, price: 280 } as PriceDto,
            ],
            priceThreshold: 300,
        };

        const result = await command.execute(context);

        expect(result.ozonPricesHighPrice).toHaveLength(1);
        expect(result.ozonPricesHighPrice[0].offer_id).toBe('sku2');
    });

    it('should use default threshold 300 if not specified', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', min_price: 300, price: 350 } as PriceDto,
                { offer_id: 'sku2', min_price: 301, price: 350 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(1);
        expect(result.ozonPrices[0].offer_id).toBe('sku1');
    });

    it('should handle empty ozonPrices', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [],
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toEqual([]);
        expect(result.ozonPricesHighPrice).toEqual([]);
    });

    it('should handle undefined ozonPrices', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toEqual([]);
        expect(result.ozonPricesHighPrice).toEqual([]);
    });
});
