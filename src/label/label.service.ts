import { Injectable } from '@nestjs/common';
import * as bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit'
import { ApiProperty } from "@nestjs/swagger";
import {
    IsArray,
    IsEnum,
    IsInt,
    IsNumber,
    IsString,
    Length,
    Max,
    Min,
    MinLength,
    ValidateNested
} from "class-validator";
import { Type } from "class-transformer";
import * as path from 'path';
import { createCanvas } from "@napi-rs/canvas";

export enum BarcodeType {
    CODE128 = 'code128',
    CODE39 = 'code39',
    QRCODE = 'qrcode',
    TEXT = 'text',
}

export class LabelDto {
    @ApiProperty({ example: '123456789012', description: 'Barcode text' })
    @IsString()
    @MinLength(1, { message: 'Code must not be empty' })
    code: string;

    @ApiProperty({ example: 'Label 1', description: 'Description of the label' })
    @IsString()
    @MinLength(1, { message: 'Description must not be empty' })
    description: string;
}

export class SizeDto {
    @ApiProperty({ example: 43, description: 'Width of the label in mm' })
    @IsNumber()
    @Min(1, { message: 'Width must be at least 1 mm' })
    width: number;

    @ApiProperty({ example: 25, description: 'Height of the label in mm' })
    @IsNumber()
    @Min(1, { message: 'Height must be at least 1 mm' })
    height: number;
}

export class GenerateBarcodeDto {
    @ApiProperty({ description: 'Тип штрихкода', enum: BarcodeType })
    @IsEnum(BarcodeType)
    bcid: BarcodeType;

    @ApiProperty({ description: 'Текст для штрихкода', example: '1234567890' })
    @IsString()
    @Length(1, 50)
    text: string;

    @ApiProperty({ description: 'Высота штрихкода', example: 10 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    height: number;

    @ApiProperty({ description: 'Ширина штрихкода', example: 30 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    width: number;
}

export class GenerateLabelsDto {
    @ApiProperty({ type: [LabelDto], description: 'Array of labels data' })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => LabelDto)
    labelsData: LabelDto[];

    @ApiProperty({ type: SizeDto, description: 'Size of each label' })
    @ValidateNested()
    @Type(() => SizeDto)
    size: SizeDto;

    @ApiProperty({ enum: BarcodeType, description: 'Type of barcode' })
    @IsEnum(BarcodeType, { message: 'Invalid barcode type' })
    barcodeType: BarcodeType;
}

@Injectable()
export class LabelService {
    private pointSize = 2.83465;

    async generateBarcode(barcodeDto: GenerateBarcodeDto): Promise<Buffer> {
        const { bcid, text, height, width } = barcodeDto;
        return bcid === BarcodeType.TEXT
        ? this.generateImageWithText(text, height, width)
        : bwipjs.toBuffer({
            bcid,
            text,
            scale: 10, // Увеличенный scale для повышения четкости штрихкода
            height,
            width,
            includetext: true,
        });
    }

    async generateImageWithText(text: string, h: number, w: number): Promise<Buffer> {
        const height = Math.round(h * this.pointSize);
        const width = Math.round(w * this.pointSize);

        // Создаем холст
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Устанавливаем фон
        ctx.fillStyle = '#ffffff'; // Белый фон
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const fontSize = Math.ceil(height / 7);

        // Настроим шрифт
        ctx.font = `${fontSize}px sans-serif`; // Используем стандартный шрифт sans-serif, или укажите путь к своему шрифту
        ctx.fillStyle = '#000000'; // Цвет текста
        ctx.textAlign = 'center'; // Выравнивание текста по центру
        ctx.textBaseline = 'middle'; // Вертикальное выравнивание по центру

        // Рисуем текст на изображении
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        // Возвращаем изображение в виде Buffer
        return canvas.toBuffer('image/png');
    }

    calculateFontSize(
        doc:  PDFKit.PDFDocument,
        text: string,
        minFontSize = 6,
        maxFontSize = 10,
        lineHeight = 1.2,
    ) {
        let fontSize = maxFontSize;
        const maxHeight = doc.page.height / 2 - 4;
        const  maxWidth = doc.page.width;
        while (fontSize >= minFontSize) {
            doc.fontSize(fontSize);

            // Рассчитать высоту текста с учётом переноса строк
            const textMetrics = doc.heightOfString(text, {
                width: maxWidth,
                lineGap: fontSize * (lineHeight - 1), // Учитываем межстрочный интервал
            });

            if (textMetrics <= maxHeight) {
                break; // Текущий размер подходит
            }


            fontSize -= 1; // Уменьшаем размер шрифта
        }

        return Math.max(fontSize, minFontSize); // Убедимся, что не вышли за минимальный размер
    }

    async generateLabels(generateLabelsDto: GenerateLabelsDto): Promise<Buffer> {
        const { labelsData, size, barcodeType } = generateLabelsDto;

        // Определение размеров и отступов для штрих-кода и текста
        const margin = Math.ceil(size.width * 0.05);
        const barcodeHeight = Math.ceil(size.height * 0.50); // Высота штрих-кода — 60% от высоты этикетки
        const barcodeWidth = Math.ceil(size.width * 0.95);   // Ширина штрих-кода — 95% от ширины этикетки
        const textYPosition = barcodeHeight;

        const doc = new PDFDocument({
            size: [size.width * this.pointSize, size.height * this.pointSize], // Размер этикетки в мм, перевод в точки (pt)
            margin: 0,
        });
        const fontPath = path.resolve(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf');
        doc.font(fontPath);

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));

        return new Promise(async (resolve, reject) => {
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                resolve(pdfBuffer);
            });

            doc.on('error', (error) => reject(error));

            for (let i = 0; i < labelsData.length; i++) {
                const label = labelsData[i];

                if (barcodeType === BarcodeType.TEXT) {
                    // Печать текста вместо штрих-кода
                    const fontSize = Math.max(9, Math.min(18, Math.ceil(size.width * 0.2)));
                    const maxTextHeight = fontSize * 6 * 1.2;

                    doc.fontSize(fontSize)
                        .text(
                            `${label.code} / ${label.description}`,
                            margin,
                            margin,
                            {
                                width: (size.width * this.pointSize) - 2 * margin,
                                height: maxTextHeight,
                                align: 'center',
                                ellipsis: true, // Добавление многоточия при переполнении
                            },
                        );
                } else {

                    // Генерация штрих-кода
                    const barcode = await bwipjs.toBuffer({
                        bcid: barcodeType,
                        text: label.code,
                        scale: 10, // Увеличенный scale для повышения четкости штрихкода
                        height: barcodeHeight,
                        width: barcodeWidth,
                        includetext: true,
                    });

                    // Добавление штрих-кода и текста на PDF
                    doc.image(
                        barcode,
                        margin,
                        0,
                        { width: barcodeWidth * this.pointSize, height: barcodeHeight * this.pointSize }
                    );

                    // const maxTextWidth = barcodeWidth * this.pointSize; // Максимальная ширина для текста
                    const dynamicFontSize = this. calculateFontSize(doc, label.description);
                    const maxTextHeight = dynamicFontSize * 4 * 1.2;
                    doc.fontSize(dynamicFontSize)
                        .text(
                            label.description,
                            margin,
                            textYPosition * this.pointSize + 2,
                            {
                                width: barcodeWidth * this.pointSize, // Ограничение ширины для авто-переноса
                                align: 'left',
                                height: maxTextHeight, // Ограничение высоты до 3 строк
                                ellipsis: true, // Добавление многоточия, если текст не помещается
                            },
                        );
                }
                if (i < labelsData.length - 1) {
                    doc.addPage(); // Переход на новую страницу для следующей этикетки
                }
            }

            doc.end();
        });
    }
}
