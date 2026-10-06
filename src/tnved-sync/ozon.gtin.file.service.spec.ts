import Excel from 'exceljs';
import { OzonGtinFileService } from './ozon.gtin.file.service';

describe('OzonGtinFileService — «Шаблон для загрузки GTIN» Озона', () => {
    const service = new OzonGtinFileService();
    const items: any[] = [
        {
            offer: '548580-10',
            name: 'Клеммы, 10 шт.',
            slot: 'extra',
            ok: false,
            marketId: 2789873858,
            add: ['00400001819968'],
        },
        { offer: '548580-100', slot: 'extra', ok: false, marketId: 2789874148, add: ['00400001819968'] },
        { offer: '569109-50', slot: 'extra', ok: false, add: ['x'] }, // без SKU писать некуда
        { offer: '476902-10', slot: 'extra', ok: true, marketId: 5, add: [] }, // уже стоит
    ];

    it('в файл идут карточки с SKU и GTIN держателя; без SKU и уже стоящие — нет', () => {
        expect(OzonGtinFileService.rows(items)).toEqual([
            { name: 'Клеммы, 10 шт.', sku: 2789873858, gtin: '00400001819968' },
            { name: '548580-100', sku: 2789874148, gtin: '00400001819968' },
        ]);
    });

    it('лист и две строки шапки — как в шаблоне кабинета; GTIN текстом с ведущими нулями', async () => {
        const file = await service.build(items);
        expect(file.rows).toBe(2);
        expect(file.filename).toMatch(/^ozon-gtin-\d{4}-\d{2}-\d{2}\.xlsx$/);
        const wb = new Excel.Workbook();
        await wb.xlsx.load(file.content as any);
        const ws = wb.getWorksheet('Страница 1');
        expect(ws.getRow(1).values).toEqual([undefined, ...OzonGtinFileService.HEAD]);
        expect(ws.getRow(2).values).toEqual([undefined, ...OzonGtinFileService.HINT]);
        expect(ws.getRow(3).getCell(2).value).toBe(2789873858);
        expect(ws.getRow(3).getCell(4).value).toBe('Есть');
        expect(ws.getRow(3).getCell(6).value).toBe('00400001819968');
        expect(ws.rowCount).toBe(4);
    });
});
