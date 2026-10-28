import { classifyScan, gtinVariants, markRefusal, matchLines } from './supply-scan.rules';
import { MarkState } from './supply-qr.store';
import { TemplateLine } from './supply-template';

const KI = '0100400004390167215O.TgmWo*G)DW66eekep';

const mark = (over: Partial<MarkState>): MarkState => ({
    markcode: 1,
    goodscode: 562939,
    status: 5,
    transferType: 0,
    quantity: 1,
    realpricecode: null,
    lineGoodscode: null,
    invoiceNumber: null,
    invoicePrim: null,
    ...over,
});

const line = (offerId: string, goodscode: number, pieces = 1): TemplateLine => ({
    offerId,
    ozonBarcode: '',
    goodscode,
    pieces,
    need: 1,
});

describe('правила скана поставки FBO', () => {
    it.each([
        ['ii50126995216', 'qr'],
        ['1022117471314000', 'cargo'],
        [KI, 'km'],
        [`${KI}\u001d91EE12\u001d92abc`, 'km'],
        ['4607001234567', 'barcode'],
        ['04600043901672', 'barcode'],
        ['OZN1754772007', 'unknown'],
        ['', 'unknown'],
    ])('%s → %s', (scan, kind) => expect(classifyScan(scan)).toBe(kind));

    it('GTIN ищем и в 14, и в 13 знаках', () => {
        expect(gtinVariants('4607001234567')).toEqual(['04607001234567', '4607001234567']);
    });

    it('продаваемый код: свободный в остатке или на строке FBO-счёта своего товара', () => {
        expect(markRefusal(mark({}))).toBeNull();
        expect(
            markRefusal(
                mark({
                    realpricecode: 7,
                    lineGoodscode: 562939,
                    invoiceNumber: 85000,
                    invoicePrim: '2000072074899 Москва FORFBO',
                }),
            ),
        ).toBeNull();
    });

    it.each([
        [{ status: 3 }, 'не введён в оборот'],
        [{ status: 6 }, 'выведен из оборота'],
        [{ transferType: 3 }, 'передан покупателю'],
        [
            { realpricecode: 7, lineGoodscode: 562939, invoiceNumber: 85001, invoicePrim: '62924335233' },
            'в резерве под счёт №85001',
        ],
        [
            { realpricecode: 7, lineGoodscode: 1, invoiceNumber: 85002, invoicePrim: 'x FORFBO' },
            'в резерве под счёт №85002',
        ],
    ])('отказ %o — «%s»', (over, text) => expect(markRefusal(mark(over))).toContain(text));

    it('количественный код подходит только к своей фасовке', () => {
        const lines = [line('555555', 555555), line('555555-10', 555555, 10), line('562990', 562990)];
        expect(matchLines(lines, [555555], null).map((l) => l.offerId)).toEqual(['555555', '555555-10']);
        expect(matchLines(lines, [555555], 10).map((l) => l.offerId)).toEqual(['555555-10']);
        expect(matchLines(lines, [1], null)).toEqual([]);
    });
});
