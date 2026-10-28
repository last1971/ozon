import Excel from 'exceljs';
import JSZip from 'jszip';
import { fillQr, readTemplate, templateBoxes } from './supply-template';

/** Шаблон Озона так, как его отдаёт ЛК: лист «Состав грузомест», строка = экземпляр, плюс лист «Инструкция». */
async function template(rows: string[][]): Promise<Buffer> {
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet('Состав грузомест');
    ws.addRow([
        'Штрихкод товара',
        'Артикул товара',
        'Годен до (в формате год-месяц-день)',
        'Штрихкод грузоместа',
        'Тип грузоместа (необязательно)',
        'QR-код',
    ]);
    rows.forEach((r) => ws.addRow(r));
    wb.addWorksheet('Инструкция').addRow(['1.', 'Создайте грузоместа']);
    return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Файл ровно в разметке ЛК Озона (28.10.2026, заявка 2000072074899): BOM, префикс x: у всех элементов,
 * абсолютные пути частей, строки через sharedStrings. exceljs такой без нормализации не читает.
 */
async function ozonFile(rows: string[][]): Promise<Buffer> {
    const BOM = '\uFEFF<?xml version="1.0" encoding="utf-8"?>';
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const head = [
        'Штрихкод товара',
        'Артикул товара',
        'Годен до (в формате год-месяц-день)',
        'Штрихкод грузоместа',
        'Тип грузоместа (необязательно)',
        'QR-код',
    ];
    const strings: string[] = [];
    const idx = (v: string) => (strings.includes(v) ? strings.indexOf(v) : strings.push(v) - 1);
    const sheetRows = [head, ...rows]
        .map(
            (r, i) =>
                `<x:row r="${i + 1}">` +
                r.map((v, j) => `<x:c r="${'ABCDEF'[j]}${i + 1}" t="s"><x:v>${idx(v)}</x:v></x:c>`).join('') +
                '</x:row>',
        )
        .join('');
    const zip = new JSZip();
    zip.file(
        '[Content_Types].xml',
        `${BOM}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" /></Types>`,
    );
    zip.file(
        '_rels/.rels',
        `${BOM}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="${REL}/officeDocument" Target="/xl/workbook.xml" Id="R1" /></Relationships>`,
    );
    zip.file(
        'xl/workbook.xml',
        `${BOM}<x:workbook xmlns:x="${NS}"><x:sheets><x:sheet name="Состав грузомест" sheetId="1" r:id="Ra" xmlns:r="${REL}" /><x:sheet name="Инструкция" sheetId="2" r:id="Rb" xmlns:r="${REL}" /></x:sheets></x:workbook>`,
    );
    zip.file(
        'xl/_rels/workbook.xml.rels',
        `${BOM}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="${REL}/worksheet" Target="/xl/worksheets/sheet1.xml" Id="Ra" /><Relationship Type="${REL}/worksheet" Target="/xl/worksheets/sheet2.xml" Id="Rb" /><Relationship Type="${REL}/sharedStrings" Target="/xl/sharedStrings.xml" Id="Rc" /></Relationships>`,
    );
    zip.file(
        'xl/worksheets/sheet1.xml',
        `${BOM}<x:worksheet xmlns:x="${NS}"><x:sheetData>${sheetRows}</x:sheetData></x:worksheet>`,
    );
    zip.file('xl/worksheets/sheet2.xml', `${BOM}<x:worksheet xmlns:x="${NS}"><x:sheetData /></x:worksheet>`);
    zip.file(
        'xl/sharedStrings.xml',
        `${BOM}<x:sst xmlns:x="${NS}">${strings.map((v) => `<x:si><x:t>${v}</x:t></x:si>`).join('')}</x:sst>`,
    );
    return zip.generateAsync({ type: 'nodebuffer' });
}

const row = (barcode: string, offer: string, cargo: string) => [barcode, offer, '', cargo, 'Коробка', ''];

describe('шаблон Озона «Состав грузомест»', () => {
    it('собирает коробки и артикулы, фасовку берёт из артикула', async () => {
        const { rows } = await readTemplate(
            await template([
                row('OZN1754772007', '562990', '1022117471311000'),
                row('OZN1754772007', '562990', '1022117471311000'),
                row('OZN1', '555555-10', '1022117471312000'),
                row('OZN2', '555555', '1022117471312000'),
            ]),
        );
        const boxes = templateBoxes(rows);
        expect(boxes.map((b) => b.cargoId)).toEqual(['1022117471311000', '1022117471312000']);
        expect(boxes[0].lines).toEqual([
            { offerId: '562990', ozonBarcode: 'OZN1754772007', goodscode: 562990, pieces: 1, need: 2 },
        ]);
        expect(boxes[1].lines.map((l) => [l.offerId, l.goodscode, l.pieces, l.need])).toEqual([
            ['555555-10', 555555, 10, 1],
            ['555555', 555555, 1, 1],
        ]);
    });

    it('читает файл в разметке ЛК Озона и отдаёт его же с QR', async () => {
        const { wb, ws, rows } = await readTemplate(
            await ozonFile([
                row('OZN1754772007', '562990', '1022117471311000'),
                row('OZN1754772007', '562990', '1022117471311000'),
            ]),
        );
        expect(templateBoxes(rows)[0].lines[0]).toMatchObject({ offerId: '562990', need: 2 });
        fillQr(ws, rows, [{ cargoId: '1022117471311000', offerId: '562990', qr: 'ii50126995216' }]);
        const again = await readTemplate(Buffer.from(await wb.xlsx.writeBuffer()));
        expect(again.rows.map((r) => r.qr)).toEqual(['ii50126995216', '']);
        expect(again.wb.worksheets.map((w) => w.name)).toEqual(['Состав грузомест', 'Инструкция']);
    });

    it('строка без коробки — ошибка с номером строки', async () => {
        const { rows } = await readTemplate(await template([row('OZN1', '562990', '')]));
        expect(() => templateBoxes(rows)).toThrow('Строка 2');
    });

    it('раскладывает этикетки по строкам своей коробки и артикула в порядке листа, лишнего не трогает', async () => {
        const { wb, ws, rows } = await readTemplate(
            await template([
                row('OZN1', '562990', 'A'),
                row('OZN2', '545641', 'B'),
                row('OZN1', '562990', 'A'),
                row('OZN1', '562990', 'A'),
            ]),
        );
        const empty = fillQr(ws, rows, [
            { cargoId: 'A', offerId: '562990', qr: 'ii1' },
            { cargoId: 'A', offerId: '562990', qr: 'ii2' },
            { cargoId: 'B', offerId: '545641', qr: 'ii3' },
        ]);
        expect(empty).toBe(1);
        const again = await readTemplate(Buffer.from(await wb.xlsx.writeBuffer()));
        expect(again.rows.map((r) => r.qr)).toEqual(['ii1', 'ii3', 'ii2', '']);
        expect(again.wb.getWorksheet('Инструкция')).toBeDefined();
    });
});
