import { Injectable } from '@nestjs/common';
import * as bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit'
import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsEnum, IsNumber, IsString, Min, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import * as fs from 'fs';
import * as path from 'path';

export enum BarcodeType {
    CODE128 = 'code128',
    CODE39 = 'code39',
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

    async generateLabels(generateLabelsDto: GenerateLabelsDto): Promise<Buffer> {
        const { labelsData, size, barcodeType } = generateLabelsDto;

        // Определение размеров и отступов для штрих-кода и текста
        const margin = Math.ceil(size.width * 0.05);
        const barcodeHeight = Math.ceil(size.height * 0.70); // Высота штрих-кода — 50% от высоты этикетки
        const barcodeWidth = Math.ceil(size.width * 0.95);   // Ширина штрих-кода — 90% от ширины этикетки
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

                const fontSize = Math.max(5, Math.min(12, Math.ceil(size.width * 0.1)));
                const maxTextHeight = fontSize * 3 * 1.2;
                doc.fontSize(fontSize)
                    .text(
                        label.description,
                        margin,
                        textYPosition * this.pointSize,
                        {
                            width: barcodeWidth * this.pointSize, // Ограничение ширины для авто-переноса
                            align: 'left',
                            height: maxTextHeight, // Ограничение высоты до 3 строк
                            ellipsis: true, // Добавление многоточия, если текст не помещается
                        },
                    );

                if (i < labelsData.length - 1) {
                    doc.addPage(); // Переход на новую страницу для следующей этикетки
                }
            }

            doc.end();
        });
    }
}
