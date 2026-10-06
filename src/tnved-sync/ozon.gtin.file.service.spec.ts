import Excel from 'exceljs';
import { OzonGtinFileService } from './ozon.gtin.file.service';

describe('OzonGtinFileService — «Шаблон для загрузки GTIN» Озона', () => {
    const config = { get: (k: string) => (k === 'INSTANCE' ? 'shop' : undefined) } as any;
    const service = new OzonGtinFileService(config);
    const items: any[] = [
        // базовая карточка: GTIN уже в баркодах (ok), но в файл идёт — проверка Озона баркоды засчитывает не всегда
        {
            offer: '355164-1',
            name: 'Штекер',
            slot: 'barcodes',
            ok: true,
            marketId: 1010925550,
            cabinetId: 1010925549,
            add: [],
            base: '00400003932993',
        },
        // фасовки — канал файла; SKU кабинета отличается от sku API
        {
            offer: '355164-10',
            name: 'Штекер, 10 шт.',
            slot: 'extra',
            ok: false,
            marketId: 1011699111,
            cabinetId: 1011699113,
            add: ['00400003932993'],
        },
        // опт: cabinetId совпадает с marketId
        {
            offer: '548580-100',
            slot: 'extra',
            ok: false,
            marketId: 2789874148,
            cabinetId: 2789874148,
            add: ['00400001819968'],
        },
        { offer: '569109-50', slot: 'extra', ok: false, add: ['x'] }, // без SKU писать некуда
        { offer: '7', slot: 'barcodes', ok: false, marketId: 7, add: [], base: '' }, // GTIN взять неоткуда
    ];

    it('строка на каждую карточку с SKU кабинета и GTIN товара; дубли SKU и карточки без SKU/GTIN — нет', () => {
        expect(OzonGtinFileService.rows(items)).toEqual([
            { name: 'Штекер', sku: 1010925549, gtin: '00400003932993' },
            { name: 'Штекер, 10 шт.', sku: 1011699113, gtin: '00400003932993' },
            { name: '548580-100', sku: 2789874148, gtin: '00400001819968' },
        ]);
    });

    it('лист и две строки шапки — как в шаблоне кабинета; GTIN текстом; инсталляция в имени файла', async () => {
        const file = await service.build(items);
        expect(file.rows).toBe(3);
        expect(file.filename).toMatch(/^ozon-gtin-shop-\d{4}-\d{2}-\d{2}\.xlsx$/);
        const wb = new Excel.Workbook();
        await wb.xlsx.load(file.content as any);
        const ws = wb.getWorksheet('Страница 1');
        expect(ws.getRow(1).values).toEqual([undefined, ...OzonGtinFileService.HEAD]);
        expect(ws.getRow(2).values).toEqual([undefined, ...OzonGtinFileService.HINT]);
        expect(ws.getRow(4).getCell(2).value).toBe(1011699113);
        expect(ws.getRow(4).getCell(4).value).toBe('Есть');
        expect(ws.getRow(4).getCell(6).value).toBe('00400003932993');
        expect(ws.rowCount).toBe(5);
    });
});
