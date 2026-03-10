import { FetchOzonCardCommand } from './fetch-ozon-card.command';
import { ProductService } from '../../product/product.service';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';

describe('FetchOzonCardCommand', () => {
    let command: FetchOzonCardCommand;
    let getProductAttributes: jest.Mock;

    const mockOzonCard = {
        name: 'LRS-350-24, Блок питания корпусной 24В 14,6А 350Вт (MW)',
        offer_id: '531557',
        barcode: 'OZN2658922494',
        height: 75,
        depth: 250,
        width: 135,
        weight: 850,
        type_id: 99309,
        description_category_id: 42872319,
        barcodes: ['OZN2658922494'],
        attributes: [
            { id: 85, values: [{ value: 'MEAN WELL' }] },
            { id: 4191, values: [{ value: 'Блок питания 24В 350Вт' }] },
            { id: 4382, values: [{ value: '215x115x30' }] },
            { id: 4383, values: [{ value: '827' }] },
            { id: 4385, values: [{ value: '14 дней' }] },
        ],
    };

    beforeEach(() => {
        getProductAttributes = jest.fn();
        command = new FetchOzonCardCommand({ getProductAttributes } as unknown as ProductService);
    });

    it('should parse ozon card and fill context', async () => {
        getProductAttributes.mockResolvedValue(mockOzonCard);

        const ctx: IWbCreateCardContext = {
            productName: '', description: '', subjectId: 0,
            offerId: '531557',
        };
        const result = await command.execute(ctx);

        expect(result.ozonName).toBe(mockOzonCard.name);
        expect(result.brand).toBe('MEAN WELL');
        expect(result.description).toBe('Блок питания 24В 350Вт');
        expect(result.ozonDimensions).toBe('215x115x30');
        expect(result.ozonWeight).toBe('827');
        expect(result.ozonWarranty).toBe('14 дней');
        expect(result.barcodes).toEqual(['OZN2658922494']);
        expect(result.ozonHeight).toBe(75);
        expect(result.ozonDepth).toBe(250);
        expect(result.ozonWidth).toBe(135);
        expect(result.ozonWeightGrams).toBe(850);
        expect(result.typeId).toBe(99309);
        expect(result.descriptionCategoryId).toBe(42872319);
        expect(result.stopChain).toBeUndefined();
    });

    it('should stopChain if card not found', async () => {
        getProductAttributes.mockResolvedValue(null);

        const ctx: IWbCreateCardContext = {
            productName: '', description: '', subjectId: 0,
            offerId: '999999',
        };
        const result = await command.execute(ctx);

        expect(result.stopChain).toBe(true);
        expect(result.error_message).toContain('999999');
    });

    it('should handle missing attributes gracefully', async () => {
        getProductAttributes.mockResolvedValue({
            ...mockOzonCard,
            attributes: [],
        });

        const ctx: IWbCreateCardContext = {
            productName: '', description: '', subjectId: 0,
            offerId: '531557',
        };
        const result = await command.execute(ctx);

        expect(result.brand).toBe('');
        expect(result.description).toBe('');
        expect(result.ozonDimensions).toBeUndefined();
        expect(result.ozonWeight).toBeUndefined();
        expect(result.ozonWarranty).toBeUndefined();
    });
});
