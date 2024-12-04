import { Test, TestingModule } from '@nestjs/testing';
import { LabelService } from "./label.service";
import * as bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { BarcodeType } from "./dto/barcodeType";
import { GenerateLabelsDto } from "./dto/generateLabelsDto";

jest.mock('bwip-js');
jest.mock('pdfkit');

describe('LabelService', () => {
    let service: LabelService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [LabelService],
        }).compile();

        service = module.get<LabelService>(LabelService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should generate a PDF buffer with labels', async () => {
        // Мокаем данные для теста
        const generateLabelsDto: GenerateLabelsDto = {
            labelsData: [
                { code: '123456789', description: 'Test Label' },
            ],
            size: { width: 50, height: 30 },
            barcodeType: BarcodeType.CODE128,
            marginX: 5,
            marginY: 0,
            barcodeHeightPercent: 50,
            barcodeWidthPercent: 95,
            spacingBetweenBarcodeAndText: 2,
        };

        // Мокирование ответа от bwip-js
        (bwipjs.toBuffer as jest.Mock).mockResolvedValue(Buffer.from('barcode'));

        // Мокирование экземпляра PDFDocument
        const pdfMock = {
            page: {
                height: 30,
                width: 50,
            },
            currentLineHeight: () => 0,
            heightOfString: () => 0,
            pipe: jest.fn(),
            font: jest.fn().mockReturnThis(),
            fontSize: jest.fn().mockReturnThis(),
            text: jest.fn().mockReturnThis(),
            image: jest.fn().mockReturnThis(),
            addPage: jest.fn().mockReturnThis(),
            end: jest.fn(),
            on: jest.fn((event: string, callback: Function) => {
                if (event === 'data') {
                    callback(Buffer.from('data'));
                } else if (event === 'end') {
                    callback();
                }
            }),
        };

        // Мокируем конструктор PDFDocument, чтобы он возвращал наш мок-объект
        (PDFDocument as unknown as jest.Mock<typeof PDFDocument>).mockImplementation(() => pdfMock as any);


        // Вызов метода
        const result = await service.generateLabels(generateLabelsDto);

        // Проверка результата
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBeGreaterThan(0);

        // Проверяем вызовы
        expect(bwipjs.toBuffer).toHaveBeenCalledWith({
            bcid: 'code128',
            text: '123456789',
            scale: 10,
            height: expect.any(Number),
            width: expect.any(Number),
            includetext: true,
        });
        expect(PDFDocument).toHaveBeenCalled();

        // Проверка вызовов методов pdfMock
        expect(pdfMock.font).toHaveBeenCalled();
        expect(pdfMock.fontSize).toHaveBeenCalled();
        expect(pdfMock.text).toHaveBeenCalled();
        expect(pdfMock.image).toHaveBeenCalled();
    });
});
