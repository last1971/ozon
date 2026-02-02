import { CalculatePercentsWithLowCommissionCommand } from './calculate-percents-with-low-commission.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { PriceService } from '../price.service';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { PriceDto } from '../dto/price.dto';

jest.mock('../../helpers', () => ({
    calculatePrice: jest.fn().mockReturnValue({
        min_price: '200',
        price: '250',
        old_price: '300',
    }),
}));

describe('CalculatePercentsWithLowCommissionCommand', () => {
    let command: CalculatePercentsWithLowCommissionCommand;
    let priceService: jest.Mocked<PriceService>;
    let priceCalculationHelper: jest.Mocked<PriceCalculationHelper>;

    beforeEach(() => {
        priceService = {
            getCommission: jest.fn(),
            getObtainCoeffs: jest.fn().mockReturnValue({}),
        } as any;
        priceCalculationHelper = {
            adjustPercents: jest.fn().mockReturnValue({ min_perc: 30, perc: 50, old_perc: 100 }),
            selectWarehouse: jest.fn(() => 'fbs'),
        } as any;
        command = new CalculatePercentsWithLowCommissionCommand(priceService, priceCalculationHelper);
    });

    it('should calculate new percents with low commission', async () => {
        priceService.getCommission.mockResolvedValue({ fbo: 0.2, fbs: 0.2 });

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                {
                    offer_id: 'sku1',
                    typeId: 123,
                    fboCount: 10,
                    fbsCount: 5,
                    incoming_price: 100,
                    available_price: 0,
                    sum_pack: 10,
                    adv_perc: 0,
                    volumeWeight: 0.3,
                } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(priceService.getCommission).toHaveBeenCalledWith('123');
        expect(priceCalculationHelper.adjustPercents).toHaveBeenCalled();
        expect(result.ozonPrices[0].min_perc).toBe(30);
        expect(result.ozonPrices[0].perc).toBe(50);
        expect(result.ozonPrices[0].old_perc).toBe(100);
    });

    it('should skip items without typeId', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', typeId: undefined } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(priceService.getCommission).not.toHaveBeenCalled();
        expect(result.ozonPrices[0].min_perc).toBeUndefined();
    });

    it('should skip items when commission not found', async () => {
        priceService.getCommission.mockResolvedValue(null);

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                { offer_id: 'sku1', typeId: 123 } as PriceDto,
            ],
        };

        const result = await command.execute(context);

        expect(priceService.getCommission).toHaveBeenCalledWith('123');
        expect(result.ozonPrices[0].min_perc).toBeUndefined();
    });

    it('should use lower commission (FBO) when FBO stock is sufficient', async () => {
        priceService.getCommission.mockResolvedValue({ fbo: 0.15, fbs: 0.2 });
        priceCalculationHelper.selectWarehouse.mockReturnValue('fbo');

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                {
                    offer_id: 'sku1',
                    typeId: 123,
                    fboCount: 80,
                    fbsCount: 20,
                    incoming_price: 100,
                    available_price: 0,
                    sum_pack: 10,
                    adv_perc: 0,
                } as PriceDto,
            ],
        };

        await command.execute(context);

        const adjustPercentsCall = priceCalculationHelper.adjustPercents.mock.calls[0][0];
        expect(adjustPercentsCall.sales_percent).toBe(15); // FBO is lower (0.15 < 0.2) and has sufficient stock
    });

    it('should use lower commission (FBS) when FBS is lower and has sufficient stock', async () => {
        priceService.getCommission.mockResolvedValue({ fbo: 0.25, fbs: 0.2 });

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                {
                    offer_id: 'sku1',
                    typeId: 123,
                    fboCount: 5,
                    fbsCount: 10,
                    incoming_price: 100,
                    available_price: 0,
                    sum_pack: 10,
                    adv_perc: 0,
                } as PriceDto,
            ],
        };

        await command.execute(context);

        const adjustPercentsCall = priceCalculationHelper.adjustPercents.mock.calls[0][0];
        expect(adjustPercentsCall.sales_percent).toBe(20); // FBS is lower (0.2 < 0.25)
    });

    it('should calculate FBS logistics based on volumeWeight', async () => {
        priceService.getCommission.mockResolvedValue({ fbo: 0.2, fbs: 0.2 });

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                {
                    offer_id: 'sku1',
                    typeId: 123,
                    fboCount: 10,
                    fbsCount: 5,
                    incoming_price: 100,
                    available_price: 0,
                    sum_pack: 10,
                    adv_perc: 0,
                    volumeWeight: 0.3, // 0.2-0.4 range = 19.32
                } as PriceDto,
            ],
        };

        await command.execute(context);

        const adjustPercentsCall = priceCalculationHelper.adjustPercents.mock.calls[0][0];
        expect(adjustPercentsCall.fbs_direct_flow_trans_max_amount).toBe(19.32);
    });

    it('should use default logistics for undefined volumeWeight', async () => {
        priceService.getCommission.mockResolvedValue({ fbo: 0.2, fbs: 0.2 });

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPrices: [
                {
                    offer_id: 'sku1',
                    typeId: 123,
                    fboCount: 10,
                    fbsCount: 5,
                    incoming_price: 100,
                    available_price: 0,
                    sum_pack: 10,
                    adv_perc: 0,
                    volumeWeight: undefined,
                } as PriceDto,
            ],
        };

        await command.execute(context);

        const adjustPercentsCall = priceCalculationHelper.adjustPercents.mock.calls[0][0];
        expect(adjustPercentsCall.fbs_direct_flow_trans_max_amount).toBe(17.28); // first tariff
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
