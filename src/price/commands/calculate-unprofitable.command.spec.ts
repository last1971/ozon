import { CalculateUnprofitableCommand } from './calculate-unprofitable.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';
import { PriceDto } from '../dto/price.dto';

jest.mock('../../helpers', () => ({
    calculatePay: jest.fn(),
}));

import { calculatePay } from '../../helpers';

describe('CalculateUnprofitableCommand', () => {
    let command: CalculateUnprofitableCommand;
    let priceService: jest.Mocked<PriceService>;
    const mockCalculatePay = calculatePay as jest.MockedFunction<typeof calculatePay>;

    beforeEach(() => {
        priceService = {
            getObtainCoeffs: jest.fn().mockReturnValue({}),
        } as any;
        command = new CalculateUnprofitableCommand(priceService);
        jest.clearAllMocks();
    });

    it('should identify unprofitable items (profit < 0)', async () => {
        mockCalculatePay.mockReturnValue({ pay: 50 } as any);

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', name: 'Product 1', incoming_price: 100, available_price: 0, marketing_seller_price: 150 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result.unprofitableItems).toHaveLength(1);
        expect(result.unprofitableItems[0]).toEqual({
            offer_id: 'sku1',
            name: 'Product 1',
            incoming_price: 100,
            selling_price: 150,
            loss: 50,
        });
    });

    it('should not include profitable items', async () => {
        mockCalculatePay.mockReturnValue({ pay: 150 } as any);

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', name: 'Product 1', incoming_price: 100, available_price: 0, marketing_seller_price: 200 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result.unprofitableItems).toHaveLength(0);
    });

    it('should use available_price when > 0', async () => {
        mockCalculatePay.mockReturnValue({ pay: 50 } as any);

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', name: 'Product 1', incoming_price: 200, available_price: 80, marketing_seller_price: 150 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result.unprofitableItems[0].incoming_price).toBe(80);
    });

    it('should skip items with zero incoming price', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', name: 'Product 1', incoming_price: 0, available_price: 0, marketing_seller_price: 150 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result.unprofitableItems).toHaveLength(0);
        expect(mockCalculatePay).not.toHaveBeenCalled();
    });

    it('should use netProfit when available', async () => {
        mockCalculatePay.mockReturnValue({ pay: 100, netProfit: -20 } as any);

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', name: 'Product 1', incoming_price: 100, available_price: 0, marketing_seller_price: 150 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(result.unprofitableItems).toHaveLength(1);
        expect(result.unprofitableItems[0].loss).toBe(20);
    });

    it('should handle empty ozonPrices', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [],
        };

        const result = await command.execute(context);

        expect(result.unprofitableItems).toEqual([]);
    });
});
