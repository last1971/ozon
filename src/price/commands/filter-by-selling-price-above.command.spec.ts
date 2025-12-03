import { FilterBySellingPriceAboveCommand } from './filter-by-selling-price-above.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceDto } from '../dto/price.dto';

describe('FilterBySellingPriceAboveCommand', () => {
    let command: FilterBySellingPriceAboveCommand;

    beforeEach(() => {
        command = new FilterBySellingPriceAboveCommand();
    });

    it('should filter prices where marketing_seller_price > threshold', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', marketing_seller_price: 400 } as PriceDto,
                { offer_id: 'sku2', marketing_seller_price: 300 } as PriceDto,
                { offer_id: 'sku3', marketing_seller_price: 200 } as PriceDto,
                { offer_id: 'sku4', marketing_seller_price: 301 } as PriceDto,
            ],
            priceThreshold: 300,
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(2);
        expect(result.ozonPrices.map(p => p.offer_id)).toEqual(['sku1', 'sku4']);
    });

    it('should use default threshold 300 if not specified', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', marketing_seller_price: 400 } as PriceDto,
                { offer_id: 'sku2', marketing_seller_price: 300 } as PriceDto,
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
    });

    it('should handle undefined ozonPrices', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toEqual([]);
    });
});
