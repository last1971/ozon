import PDFKit from 'pdfkit';
import { PDFDocument } from 'pdf-lib';
import TextOptions = PDFKit.Mixins.TextOptions;

/**
 * Оставляет в PDF только первую страницу. Озон в package-label всегда подкладывает
 * товарный ярлык вторым листом — печатаем только ШК отправления (стр.1).
 * Если страница одна — возвращает исходный буфер как есть.
 */
export const firstPageOnly = async (pdf: Buffer): Promise<Buffer> => {
    const src = await PDFDocument.load(pdf);
    if (src.getPageCount() <= 1) return pdf;
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(src, [0]);
    out.addPage(page);
    return Buffer.from(await out.save());
};

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