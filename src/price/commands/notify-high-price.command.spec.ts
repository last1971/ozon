import { NotifyHighPriceCommand } from './notify-high-price.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PriceDto } from '../dto/price.dto';

describe('NotifyHighPriceCommand', () => {
    let command: NotifyHighPriceCommand;
    let eventEmitter: jest.Mocked<EventEmitter2>;

    beforeEach(() => {
        eventEmitter = {
            emit: jest.fn(),
        } as any;
        command = new NotifyHighPriceCommand(eventEmitter);
    });

    it('should emit event with high price items', async () => {
        const highPriceItems: PriceDto[] = [
            { offer_id: 'sku1', price: 400 } as PriceDto,
            { offer_id: 'sku2', price: 500 } as PriceDto,
        ];

        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPricesHighPrice: highPriceItems,
        };

        await command.execute(context);

        expect(eventEmitter.emit).toHaveBeenCalledWith('ozon.high.price', highPriceItems);
    });

    it('should not emit event if ozonPricesHighPrice is empty', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            ozonPricesHighPrice: [],
        };

        await command.execute(context);

        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should not emit event if ozonPricesHighPrice is undefined', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
        };

        await command.execute(context);

        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should return context unchanged', async () => {
        const context: IGoodsProcessingContext = {
            skus: ['test'],
            ozonPricesHighPrice: [{ offer_id: 'sku1' } as PriceDto],
        };

        const result = await command.execute(context);

        expect(result).toBe(context);
    });
});
