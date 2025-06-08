import PDFKit from 'pdfkit';
import TextOptions = PDFKit.Mixins.TextOptions;

export type CalculateFontSizeParams = {
    doc: PDFKit.PDFDocument; // Экземпляр PDFKit документа
    text: string; // Текст, который нужно разместить
    maxTextHeight: number; // Максимальная высота текстового блока
    options?: TextOptions;
    minFontSize?: number; // Минимальный размер шрифта (по умолчанию 6)
    maxFontSize?: number; // Максимальный размер шрифта (по умолчанию 16)
};

/**
 * Подбирает оптимальный размер шрифта для текста, чтобы он поместился в заданную высоту
 */
export const calculateOptimalFontSize = ({
    doc,
    text,
    maxTextHeight,
    options = {},
    minFontSize = 6,
    maxFontSize = 30,
}: CalculateFontSizeParams): number => {
    let fontSize = minFontSize;
    for (let calculateFontSize = maxFontSize; calculateFontSize > minFontSize; calculateFontSize--) {
        doc.fontSize(calculateFontSize);
        const lineHeight = doc.currentLineHeight(true);
        const heightOfString = doc.heightOfString(text, options);
        const totalTextHeight = Math.ceil(heightOfString / lineHeight);
        if (totalTextHeight * lineHeight <= maxTextHeight) {
            fontSize = calculateFontSize;
            break;
        }
    }
    return fontSize;
}; 