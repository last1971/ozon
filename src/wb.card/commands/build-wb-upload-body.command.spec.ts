import { BuildWbUploadBodyCommand } from './build-wb-upload-body.command';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';

describe('BuildWbUploadBodyCommand', () => {
    let command: BuildWbUploadBodyCommand;

    beforeEach(() => {
        command = new BuildWbUploadBodyCommand();
    });

    it('should build upload body with correct structure', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: 'Описание товара', subjectId: 2009,
            offerId: '531557',
            brand: 'MEAN WELL',
            title: 'LRS-350-24 Блок питания 24В 350Вт',
            ozonDepth: 250,
            ozonWidth: 135,
            ozonHeight: 75,
            ozonWeightGrams: 850,
            barcodes: ['OZN2658922494'],
            characteristics: [{ id: 5023, value: 'LRS-350-24' }],
        };
        const result = await command.execute(ctx);

        expect(result.uploadBody).toBeDefined();
        expect(result.uploadBody).toHaveLength(1);

        const card = result.uploadBody[0];
        expect(card.subjectID).toBe(2009);
        expect(card.variants).toHaveLength(1);

        const variant = card.variants[0];
        expect(variant.brand).toBe('MEAN WELL');
        expect(variant.title).toBe('LRS-350-24 Блок питания 24В 350Вт');
        expect(variant.vendorCode).toBe('531557');
        expect(variant.wholesale).toBeUndefined();
    });

    it('should convert mm to cm and g to kg', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            offerId: '531557',
            ozonDepth: 250,   // mm
            ozonWidth: 135,   // mm
            ozonHeight: 75,   // mm
            ozonWeightGrams: 850,  // g
            barcodes: [],
        };
        const result = await command.execute(ctx);
        const dims = result.uploadBody[0].variants[0].dimensions;

        expect(dims.length).toBe(25);      // 250/10
        expect(dims.width).toBe(13.5);     // 135/10
        expect(dims.height).toBe(7.5);     // 75/10
        expect(dims.weightBrutto).toBe(0.85); // 850/1000
    });

    it('should strip HTML from description', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', subjectId: 2009,
            description: '<p>Текст<br/>с <b>HTML</b></p><ul><li>Пункт 1</li><li>Пункт 2</li></ul>',
            offerId: '531557',
            ozonDepth: 100, ozonWidth: 100, ozonHeight: 100, ozonWeightGrams: 100,
            barcodes: [],
        };
        const result = await command.execute(ctx);
        const desc = result.uploadBody[0].variants[0].description;

        expect(desc).not.toContain('<p>');
        expect(desc).not.toContain('<b>');
        expect(desc).not.toContain('<ul>');
        expect(desc).toContain('Текст');
        expect(desc).toContain('Пункт 1');
    });

    it('should truncate description to 2000 chars', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', subjectId: 2009,
            description: 'A'.repeat(3000),
            offerId: '531557',
            ozonDepth: 100, ozonWidth: 100, ozonHeight: 100, ozonWeightGrams: 100,
            barcodes: [],
        };
        const result = await command.execute(ctx);
        const desc = result.uploadBody[0].variants[0].description;

        expect(desc.length).toBeLessThanOrEqual(2000);
    });

    it('should strip emojis from description', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', subjectId: 2009,
            description: 'Модем 💾 с поддержкой 📡 5G 💪',
            offerId: '531557',
            ozonDepth: 100, ozonWidth: 100, ozonHeight: 100, ozonWeightGrams: 100,
            barcodes: [],
        };
        const result = await command.execute(ctx);
        const desc = result.uploadBody[0].variants[0].description;

        expect(desc).not.toMatch(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u);
        expect(desc).toContain('Модем');
        expect(desc).toContain('5G');
    });

    it('should set price=10000 and skus from barcodes', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            offerId: '531557',
            ozonDepth: 100, ozonWidth: 100, ozonHeight: 100, ozonWeightGrams: 100,
            barcodes: ['OZN123', 'OZN456'],
        };
        const result = await command.execute(ctx);
        const size = result.uploadBody[0].variants[0].sizes[0];

        expect(size.price).toBe(10000);
        expect(size.skus).toEqual(['OZN123', 'OZN456']);
        expect(size.techSize).toBe('0');
    });
});
