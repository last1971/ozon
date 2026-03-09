import { BuildWbCharcsCommand } from './build-wb-charcs.command';
import { ConfigService } from '@nestjs/config';
import { IWbCreateCardContext, WbCharc } from '../interfaces/wb-create-card.interface';

describe('BuildWbCharcsCommand', () => {
    let command: BuildWbCharcsCommand;
    let configGet: jest.Mock;

    const mockCharcs: WbCharc[] = [
        { charcID: 5023, name: 'Модель', required: false, unitName: '', maxCount: 1, popular: true, charcType: 1 },
        { charcID: 355421, name: 'Напряжение (В)', required: false, unitName: 'В', maxCount: 0, popular: false, charcType: 4 },
        { charcID: 378533, name: 'Комплектация', required: false, unitName: '', maxCount: 12, popular: false, charcType: 1 },
        { charcID: 15001405, name: 'Ставка НДС', required: false, unitName: '', maxCount: 1, popular: false, charcType: 1 },
        { charcID: 90630, name: 'Высота предмета', required: false, unitName: 'см', maxCount: 0, popular: false, charcType: 4 },
        { charcID: 90652, name: 'Глубина предмета', required: false, unitName: 'см', maxCount: 0, popular: false, charcType: 4 },
        { charcID: 90673, name: 'Ширина предмета', required: false, unitName: 'см', maxCount: 0, popular: false, charcType: 4 },
        { charcID: 89008, name: 'Вес товара без упаковки (г)', required: false, unitName: 'г', maxCount: 0, popular: false, charcType: 4 },
        { charcID: 9623, name: 'Гарантийный срок', required: false, unitName: '', maxCount: 3, popular: false, charcType: 1 },
    ];

    beforeEach(() => {
        configGet = jest.fn().mockReturnValue(5);
        command = new BuildWbCharcsCommand({ get: configGet } as unknown as ConfigService);
    });

    it('should map AI characteristics', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            charcs: mockCharcs,
            aiCharacteristics: [
                { id: 5023, value: 'LRS-350-24' },
                { id: 355421, value: 24 },
            ],
        };
        const result = await command.execute(ctx);

        expect(result.characteristics).toBeDefined();
        const model = result.characteristics.find((c) => c.id === 5023);
        expect(model.value).toBe('LRS-350-24');
        const voltage = result.characteristics.find((c) => c.id === 355421);
        expect(voltage.value).toBe(24);
    });

    it('should add НДС from config', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            charcs: mockCharcs,
            aiCharacteristics: [],
        };
        const result = await command.execute(ctx);

        const vat = result.characteristics.find((c) => c.id === 15001405);
        expect(vat).toBeDefined();
        expect(vat.value).toBe('5%');
    });

    it('should not add НДС if not configured', async () => {
        configGet.mockReturnValue(undefined);
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            charcs: mockCharcs,
            aiCharacteristics: [],
        };
        const result = await command.execute(ctx);

        const vat = result.characteristics.find((c) => c.id === 15001405);
        expect(vat).toBeUndefined();
    });

    it('should parse ozonDimensions and convert mm to cm', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            charcs: mockCharcs,
            aiCharacteristics: [],
            ozonDimensions: '215x115x30',
        };
        const result = await command.execute(ctx);

        const depth = result.characteristics.find((c) => c.id === 90652);
        const width = result.characteristics.find((c) => c.id === 90673);
        const height = result.characteristics.find((c) => c.id === 90630);
        expect(depth.value).toBe(21.5);
        expect(width.value).toBe(11.5);
        expect(height.value).toBe(3);
    });

    it('should add ozonWeight', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            charcs: mockCharcs,
            aiCharacteristics: [],
            ozonWeight: '827',
        };
        const result = await command.execute(ctx);

        const weight = result.characteristics.find((c) => c.id === 89008);
        expect(weight.value).toBe(827);
    });

    it('should add ozonWarranty', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            charcs: mockCharcs,
            aiCharacteristics: [],
            ozonWarranty: '14 дней',
        };
        const result = await command.execute(ctx);

        const warranty = result.characteristics.find((c) => c.id === 9623);
        expect(warranty.value).toBe('14 дней');
    });

    it('should format array values with maxCount limit', async () => {
        const ctx: IWbCreateCardContext = {
            productName: 'Test', description: '', subjectId: 2009,
            charcs: mockCharcs,
            aiCharacteristics: [
                { id: 378533, value: ['Блок питания', 'Документация', 'Инструкция'] },
            ],
        };
        const result = await command.execute(ctx);

        const comp = result.characteristics.find((c) => c.id === 378533);
        expect(Array.isArray(comp.value)).toBe(true);
        expect((comp.value as string[]).length).toBeLessThanOrEqual(12);
    });
});
