import { Test, TestingModule } from '@nestjs/testing';
import { PriceService } from './price.service';
import { ProductService } from '../product/product.service';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { ConfigService } from '@nestjs/config';
import { ProductVisibility } from '../product/product.visibility';
import { AutoAction } from './dto/update.price.dto';

describe('PriceService', () => {
    let service: PriceService;
    const getPrices = jest.fn().mockResolvedValue({
        items: [
            { offer_id: '1', price: {}, commissions: { sales_percent: 1, fbs_direct_flow_trans_max_amount: 2 } },
            { offer_id: '2', price: {}, commissions: { sales_percent: 1, fbs_direct_flow_trans_max_amount: 2 } },
            { offer_id: '3', price: {}, commissions: { sales_percent: 1, fbs_direct_flow_trans_max_amount: 2 } },
        ],
    });
    const prices = jest.fn().mockResolvedValue([
        { code: 1, name: '1' },
        { code: 2, name: '2' },
        { code: 3, name: '3' },
    ]);
    const getPerc = jest.fn().mockResolvedValue([]);
    const setPrice = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PriceService,
                { provide: ProductService, useValue: { getPrices, setPrice } },
                { provide: GOOD_SERVICE, useValue: { prices, getPerc } },
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string) => {
                            switch (key) {
                                case 'PERC_MIN':
                                    return 1;
                                case 'PERC_NOR':
                                    return 2;
                                case 'PERC_MAX':
                                    return 3;
                                case 'PERC_MIL':
                                    return 5.5;
                                case 'PERC_EKV':
                                    return 1.5;
                                case 'SUM_OBTAIN':
                                    return 25;
                                case 'SUM_PACK':
                                    return 13;
                                default:
                                    return null;
                            }
                        },
                    },
                },
            ],
        }).compile();

        service = module.get<PriceService>(PriceService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test preset', async () => {
        await expect(service.preset()).resolves.toEqual({
            perc_min: 1,
            perc_nor: 2,
            perc_max: 3,
            perc_mil: 5.5,
            perc_ekv: 1.5,
            sum_obtain: 25,
            sum_pack: 13,
        });
    });

    it('test index', async () => {
        await service.index({ limit: 0, visibility: ProductVisibility.VISIBLE });
        expect(getPrices.mock.calls[0]).toEqual([{ limit: 0, visibility: 'VISIBLE' }]);
        expect(prices.mock.calls[0]).toEqual([['1', '2', '3']]);
        expect(getPerc.mock.calls[0]).toEqual([['1', '2', '3']]);
    });

    it('test update', async () => {
        await service.update({ prices: [] });
        expect(setPrice.mock.calls[0]).toEqual([{ prices: [] }]);
    });

    it('test calculatePrice', () => {
        expect(
            service.calculatePrice({
                adv_perc: 1,
                auto_action_enabled: false,
                fbs_direct_flow_trans_max_amount: 20,
                incoming_price: 100,
                marketing_price: 0,
                marketing_seller_price: 0,
                min_perc: 10,
                min_price: 0,
                name: 'test',
                offer_id: '123',
                old_perc: 100,
                old_price: 0,
                perc: 50,
                price: 0,
                product_id: 0,
                sales_percent: 20,
            }),
        ).toEqual({
            auto_action_enabled: AutoAction.UNKNOWN,
            currency_code: 'RUB',
            min_price: '234',
            offer_id: '123',
            old_price: '359',
            price: '289',
        });
    });
});
