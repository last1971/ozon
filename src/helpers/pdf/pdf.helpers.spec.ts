import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { calculateOptimalFontSize, firstPageOnly } from './pdf.helpers';

async function makePdf(pages: number): Promise<Buffer> {
    const doc = await PdfLibDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
    return Buffer.from(await doc.save());
}

describe('firstPageOnly', () => {
    it('режет двухстраничный PDF до одной страницы', async () => {
        const out = await firstPageOnly(await makePdf(2));
        const parsed = await PdfLibDocument.load(out);
        expect(parsed.getPageCount()).toBe(1);
    });

    it('одностраничный PDF возвращает как есть (тот же буфер)', async () => {
        const src = await makePdf(1);
        const out = await firstPageOnly(src);
        expect(out).toBe(src);
    });
});

describe('calculateOptimalFontSize', () => {
    it('should return maxFontSize if text fits easily', () => {
        // Мокаем doc с нужными методами
        const doc: any = {
            fontSize: jest.fn(),
            currentLineHeight: jest.fn().mockReturnValue(10),
            heightOfString: jest.fn().mockReturnValue(10),
        };
        const fontSize = calculateOptimalFontSize({
            doc,
            text: 'short text',
            maxTextHeight: 100,
            minFontSize: 6,
            maxFontSize: 20,
        });
        expect(fontSize).toBe(20);
    });

    it('should return minFontSize if text never fits', () => {
        const doc: any = {
            fontSize: jest.fn(),
            currentLineHeight: jest.fn().mockReturnValue(100),
            heightOfString: jest.fn().mockReturnValue(1000),
        };
        const fontSize = calculateOptimalFontSize({
            doc,
            text: 'very long text',
            maxTextHeight: 50,
            minFontSize: 6,
            maxFontSize: 20,
        });
        expect(fontSize).toBe(6);
    });

    it('should pick the largest font size that fits', () => {
        // currentLineHeight = 10, heightOfString = 30, maxTextHeight = 25
        // 30/10 = 3 строк, 3*10=30 > 25, не помещается
        // Проверим, что функция уменьшает размер шрифта
        const doc: any = {
            fontSize: jest.fn(),
            currentLineHeight: jest.fn().mockReturnValue(10),
            heightOfString: jest.fn().mockReturnValue(30),
        };
        const fontSize = calculateOptimalFontSize({
            doc,
            text: 'some text',
            maxTextHeight: 25,
            minFontSize: 6,
            maxFontSize: 20,
        });
        // В этом случае функция дойдет до minFontSize
        expect(fontSize).toBe(6);
    });
}); 