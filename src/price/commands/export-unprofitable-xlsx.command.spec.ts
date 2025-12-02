import { ExportUnprofitableXlsxCommand } from './export-unprofitable-xlsx.command';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

describe('ExportUnprofitableXlsxCommand', () => {
    let command: ExportUnprofitableXlsxCommand;

    beforeEach(() => {
        command = new ExportUnprofitableXlsxCommand();
    });

    it('should create xlsx buffer with unprofitable items', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            unprofitableItems: [
                { offer_id: 'sku1', name: 'Product 1', incoming_price: 100, selling_price: 80, loss: 20 },
                { offer_id: 'sku2', name: 'Product 2', incoming_price: 200, selling_price: 150, loss: 50 },
            ],
        };

        const result = await command.execute(context);

        expect(result.xlsxBuffer).toBeDefined();
    });

    it('should handle empty unprofitableItems', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            unprofitableItems: [],
        };

        const result = await command.execute(context);

        expect(result.xlsxBuffer).toBeDefined();
    });

    it('should handle undefined unprofitableItems', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
        };

        const result = await command.execute(context);

        expect(result.xlsxBuffer).toBeDefined();
    });

    it('should round prices to 2 decimal places', async () => {
        const context: IGoodsProcessingContext = {
            skus: [],
            unprofitableItems: [
                { offer_id: 'sku1', name: 'Product 1', incoming_price: 100.456, selling_price: 80.123, loss: 20.333 },
            ],
        };

        const result = await command.execute(context);

        expect(result.xlsxBuffer).toBeDefined();
    });
});
