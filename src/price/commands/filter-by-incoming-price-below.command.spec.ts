import { FilterByIncomingPriceBelowCommand } from './filter-by-incoming-price-below.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceDto } from '../dto/price.dto';

describe('FilterByIncomingPriceBelowCommand', () => {
    let command: FilterByIncomingPriceBelowCommand;

    beforeEach(() => {
        command = new FilterByIncomingPriceBelowCommand();
    });

    it('should filter prices where effective incoming_price > 0 and < maxPrice', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', incoming_price: 100, available_price: 0 } as PriceDto,
                { offer_id: 'sku2', incoming_price: 200, available_price: 0 } as PriceDto,
                { offer_id: 'sku3', incoming_price: 50, available_price: 0 } as PriceDto,
            ],
            filterMaxIncomingPrice: 150,
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(2);
        expect(result.ozonPrices.map(p => p.offer_id)).toEqual(['sku1', 'sku3']);
    });

    it('should use available_price when > 0', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', incoming_price: 200, available_price: 100 } as PriceDto,
                { offer_id: 'sku2', incoming_price: 50, available_price: 200 } as PriceDto,
            ],
            filterMaxIncomingPrice: 150,
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(1);
        expect(result.ozonPrices[0].offer_id).toBe('sku1');
    });

    it('should use default maxPrice 150 if not specified', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', incoming_price: 100, available_price: 0 } as PriceDto,
                { offer_id: 'sku2', incoming_price: 160, available_price: 0 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(1);
        expect(result.ozonPrices[0].offer_id).toBe('sku1');
    });

    it('should filter out items with zero incoming price', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', incoming_price: 0, available_price: 0 } as PriceDto,
                { offer_id: 'sku2', incoming_price: 100, available_price: 0 } as PriceDto,
            ],
            filterMaxIncomingPrice: 150,
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(1);
        expect(result.ozonPrices[0].offer_id).toBe('sku2');
    });

    it('should filter out items with zero available_price and zero incoming_price', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', incoming_price: 0, available_price: 0 } as PriceDto,
            ],
            filterMaxIncomingPrice: 150,
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toHaveLength(0);
    });

    it('should handle empty ozonPrices', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [],
        };

        const result = await command.execute(context);

        expect(result.ozonPrices).toEqual([]);
    });
});
