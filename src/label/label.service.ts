import { Injectable } from "@nestjs/common";
import * as bwipjs from "bwip-js";
import PDFDocument from "pdfkit";
import * as path from "path";
import { createCanvas } from "@napi-rs/canvas";
import { calculateOptimalFontSize } from "../helpers";
import { BarcodeType } from "./dto/barcodeType";
import { GenerateBarcodeDto } from "./dto/generateBarcodeDto";
import { GenerateLabelsDto } from "./dto/generateLabelsDto";
import TextOptions = PDFKit.Mixins.TextOptions;

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

    async generateLabels(generateLabelsDto: GenerateLabelsDto): Promise<Buffer> {
        const {
            labelsData,
            size,
            barcodeType,
            marginX,
            marginY,
            barcodeHeightPercent,
            barcodeWidthPercent,
            spacingBetweenBarcodeAndText
        } = generateLabelsDto;

        const pointSize = this.pointSize;
        const pageSize = [size.width * pointSize, size.height * pointSize];
        const horizontalMargin = Math.ceil(size.width * (marginX / 100));
        const verticalMargin = Math.ceil(size.height * (marginY / 100));
        const barcodeHeight = Math.ceil(size.height * (barcodeHeightPercent / 100)) * pointSize;
        const textHeight = Math.ceil(size.height * ((100 - barcodeHeightPercent) / 100)) * pointSize
            - verticalMargin * 2 - spacingBetweenBarcodeAndText;
        const barcodeWidth = Math.ceil(size.width * (barcodeWidthPercent / 100)) * pointSize;

        const doc = new PDFDocument({ size: pageSize, margin: 0 });
        const fontPath = path.resolve(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf');
        doc.font(fontPath);

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));

        return new Promise(async (resolve, reject) => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            for (let i = 0; i < labelsData.length; i++) {
                const label = labelsData[i];
                const options: TextOptions = {
                    align: 'left',
                    ellipsis: true, // Добавление многоточия при переполнении
                };
                if (barcodeType === BarcodeType.TEXT) {
                    // Печать текста вместо штрих-кода
                    const text = `${label.code} / ${label.description}`;
                    const maxTextHeight = size.height * this.pointSize - verticalMargin * 2;
                    const fontSize = calculateOptimalFontSize({doc, text, maxTextHeight, options});
                    doc.fontSize(fontSize)
                        .text(
                            `${label.code} / ${label.description}`,
                            horizontalMargin,
                            verticalMargin,
                            { ...options, height: maxTextHeight },
                        );
                } else {
                    // Генерация штрих-кода
                    const barcode = await bwipjs.toBuffer({
                        bcid: barcodeType,
                        text: label.code,
                        scale: 10, // Увеличенный scale для повышения четкости штрихкода
                        height: barcodeHeight / this.pointSize,
                        width: barcodeWidth / this.pointSize,
                        includetext: true,
                    });

                    // Добавление штрих-кода и текста на PDF
                    doc.image(
                        barcode,
                        horizontalMargin,
                        verticalMargin,
                        { width: barcodeWidth, height: barcodeHeight }
                    );
                    const dynamicFontSize = calculateOptimalFontSize({
                        doc,
                        text: label.description,
                        maxTextHeight: textHeight,
                        options
                    });
                    doc.fontSize(dynamicFontSize)
                        .text(
                            label.description,
                            horizontalMargin,
                            verticalMargin + barcodeHeight + spacingBetweenBarcodeAndText,
                            { ...options, height: textHeight },
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
