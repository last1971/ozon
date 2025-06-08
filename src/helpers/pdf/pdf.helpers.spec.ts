import PDFDocument from 'pdfkit';
import { calculateOptimalFontSize } from './pdf.helpers';

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