import { Test, TestingModule } from '@nestjs/testing';
import { GoodController } from './good.controller';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { ExtraGoodService } from './extra.good.service';
import { GoodServiceEnum } from './good.service.enum';

describe('GoodController', () => {
    let controller: GoodController;
    let extraGoodService: jest.Mocked<ExtraGoodService>;

    beforeEach(async () => {
        const mockExtraGoodService = {
            getSkuList: jest.fn(),
            disableByCodes: jest.fn(),
            skusFromFile: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [GoodController],
            providers: [
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: ExtraGoodService, useValue: mockExtraGoodService },
            ],
        }).compile();

        controller = module.get<GoodController>(GoodController);
        extraGoodService = module.get<ExtraGoodService>(ExtraGoodService) as jest.Mocked<ExtraGoodService>;
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('disable', () => {
        it('передаёт SKU из тела, когда файла нет', async () => {
            const expected = { isSuccess: true, message: 'ok' };
            extraGoodService.disableByCodes.mockResolvedValue(expected);

            const result = await controller.disable(
                { service: GoodServiceEnum.WB, skus: ['A1', 'A2'] },
                undefined,
            );

            expect(extraGoodService.skusFromFile).not.toHaveBeenCalled();
            expect(extraGoodService.disableByCodes).toHaveBeenCalledWith(GoodServiceEnum.WB, ['A1', 'A2']);
            expect(result).toBe(expected);
        });

        it('парсит SKU из файла, когда он передан', async () => {
            extraGoodService.skusFromFile.mockResolvedValue(['F1', 'F2']);
            extraGoodService.disableByCodes.mockResolvedValue({ isSuccess: true, message: 'ok' });
            const file = { buffer: Buffer.from('xlsx') } as Express.Multer.File;

            await controller.disable({ service: GoodServiceEnum.OZON, skus: ['ignored'] }, file);

            expect(extraGoodService.skusFromFile).toHaveBeenCalledWith(file.buffer);
            expect(extraGoodService.disableByCodes).toHaveBeenCalledWith(GoodServiceEnum.OZON, ['F1', 'F2']);
        });

        it('пустое тело без файла — передаёт []', async () => {
            extraGoodService.disableByCodes.mockResolvedValue({ isSuccess: false, message: 'x' });

            await controller.disable({ service: GoodServiceEnum.WB }, undefined);

            expect(extraGoodService.disableByCodes).toHaveBeenCalledWith(GoodServiceEnum.WB, []);
        });
    });

    describe('getSkuList', () => {
        it('should return SKU list for OZON service', async () => {
            const expectedSkus = ['SKU1', 'SKU2', 'SKU3'];
            extraGoodService.getSkuList.mockReturnValue(expectedSkus);

            const result = await controller.getSkuList(GoodServiceEnum.OZON);

            expect(extraGoodService.getSkuList).toHaveBeenCalledWith(GoodServiceEnum.OZON);
            expect(result).toEqual(expectedSkus);
        });

        it('should return SKU list for WB service', async () => {
            const expectedSkus = ['WB-SKU1', 'WB-SKU2'];
            extraGoodService.getSkuList.mockReturnValue(expectedSkus);

            const result = await controller.getSkuList(GoodServiceEnum.WB);

            expect(extraGoodService.getSkuList).toHaveBeenCalledWith(GoodServiceEnum.WB);
            expect(result).toEqual(expectedSkus);
        });

        it('should return empty array when service has no SKUs', async () => {
            extraGoodService.getSkuList.mockReturnValue([]);

            const result = await controller.getSkuList(GoodServiceEnum.YANDEX);

            expect(extraGoodService.getSkuList).toHaveBeenCalledWith(GoodServiceEnum.YANDEX);
            expect(result).toEqual([]);
        });

        it('should handle all service types', async () => {
            const services = [
                GoodServiceEnum.OZON,
                GoodServiceEnum.WB,
                GoodServiceEnum.YANDEX,
                GoodServiceEnum.EXPRESS,
                GoodServiceEnum.AVITO,
            ];

            for (const service of services) {
                extraGoodService.getSkuList.mockClear();
                extraGoodService.getSkuList.mockReturnValue([`${service}-SKU`]);

                const result = await controller.getSkuList(service);

                expect(extraGoodService.getSkuList).toHaveBeenCalledWith(service);
                expect(result).toEqual([`${service}-SKU`]);
            }
        });
    });
});
