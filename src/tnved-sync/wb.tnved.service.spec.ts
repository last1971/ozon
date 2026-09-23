import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbTnvedService } from './wb.tnved.service';

describe('WbTnvedService', () => {
    let service: WbTnvedService;
    const getAllWbCards = jest.fn();
    const getCharacteristics = jest.fn();
    const method = jest.fn();

    const SUBJECT = 2009; // «Блоки питания»
    const TNVED_CHARC = { charcID: 15000001, name: 'ТНВЭД', required: false, unitName: '', maxCount: 1, popular: false, charcType: 1 };
    const DIRECTORY = { data: [{ tnved: '8504403003', isKiz: false }, { tnved: '8504408300', isKiz: false }] };

    // карточка ВБ: tnved — значение характеристики 15000001 (undefined = характеристики нет)
    const card = (vendorCode: string, tnved?: string | string[], subjectID = SUBJECT) => ({
        nmID: 1,
        vendorCode,
        title: `PROD-${vendorCode}`,
        subjectID,
        subjectName: 'Блоки питания',
        characteristics: tnved === undefined ? [] : [{ id: 15000001, name: 'ТНВЭД', value: tnved }],
        photos: [],
        sizes: [],
    });

    const base = (goodscode: string, tnved: string, markRequired = true) => ({ goodscode, tnved, markRequired });

    beforeEach(async () => {
        [getAllWbCards, getCharacteristics, method].forEach((m) => m.mockReset());
        getCharacteristics.mockResolvedValue([TNVED_CHARC]);
        method.mockResolvedValue(DIRECTORY);
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                WbTnvedService,
                { provide: WbCardService, useValue: { getAllWbCards, getCharacteristics } },
                { provide: WbApiService, useValue: { method } },
                { provide: ConfigService, useValue: { get: (_k: string, def: any) => def } },
            ],
        }).compile();
        service = moduleRef.get(WbTnvedService);
    });

    it('код совпадает → ok', async () => {
        getAllWbCards.mockResolvedValue([card('565831', ['8504408300'])]);

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items).toHaveLength(1);
        expect(res.items[0]).toMatchObject({ offer: '565831', current: '8504408300', ok: true });
        expect(res.notFound).toEqual([]);
    });

    it('код другой → на правку с причиной', async () => {
        getAllWbCards.mockResolvedValue([card('565831', '8504403003')]);

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items[0]).toMatchObject({ ok: false, current: '8504403003', base: '8504408300' });
        expect(res.items[0].reason).toContain('8504403003→8504408300');
        expect(res.items[0].ambiguousReason).toBeUndefined();
    });

    it('характеристики на карточке нет → на правку, current null', async () => {
        getAllWbCards.mockResolvedValue([card('565831')]);

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items[0]).toMatchObject({ ok: false, current: null });
        expect(res.items[0].reason).toContain('—→8504408300');
    });

    it('нашего кода нет в справочнике предмета → спорно', async () => {
        getAllWbCards.mockResolvedValue([card('565831', '8504408300')]);

        const res = await service.checkTnved([base('565831', '9999999999')]);

        expect(res.items[0].ok).toBe(false);
        expect(res.items[0].ambiguousReason).toContain('нет в справочнике предмета');
    });

    it('справочник предмета не отдан (api вернул error) → спорно, не «нет в справочнике»', async () => {
        getAllWbCards.mockResolvedValue([card('565831', '8504408300')]);
        method.mockResolvedValue({ result: null, status: 'NotOk', error: { message: 'boom' } });

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items[0].ambiguousReason).toContain('не отдан');
    });

    it('у предмета нет характеристики ТНВЭД → спорно, справочник не запрашиваем', async () => {
        getAllWbCards.mockResolvedValue([card('565831', undefined, 964)]);
        getCharacteristics.mockResolvedValue([{ ...TNVED_CHARC, charcID: 15004139, name: 'Код ТН ВЭД' }]);

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items[0].ambiguousReason).toContain('нет характеристики ТНВЭД');
        expect(method).not.toHaveBeenCalled();
    });

    it('справочник и характеристики предмета запрашиваются один раз на предмет', async () => {
        getAllWbCards.mockResolvedValue([card('1', '8504408300'), card('2', '8504408300')]);

        await service.checkTnved([base('1', '8504408300'), base('2', '8504408300')]);

        expect(method).toHaveBeenCalledTimes(1);
        expect(method).toHaveBeenCalledWith(
            'https://content-api.wildberries.ru/content/v2/directory/tnved',
            'get',
            { subjectID: SUBJECT, locale: 'ru' },
            true,
        );
        expect(getCharacteristics).toHaveBeenCalledTimes(1);
    });

    it('суффиксные vendorCode (531557 и 531557-10) — обе карточки товара', async () => {
        getAllWbCards.mockResolvedValue([card('531557', '8504408300'), card('531557-10', '8504403003')]);

        const res = await service.checkTnved([base('531557', '8504408300')]);

        expect(res.items.map((i) => [i.offer, i.ok])).toEqual([
            ['531557', true],
            ['531557-10', false],
        ]);
    });

    it('на ВБ нет ни одной карточки товара → notFound', async () => {
        getAllWbCards.mockResolvedValue([card('1', '8504408300')]);

        const res = await service.checkTnved([base('2', '8504408300')]);

        expect(res.items).toEqual([]);
        expect(res.notFound).toEqual(['2']);
    });

    it('updateTnved пока не пишет — на каждую карточку error', async () => {
        const res = await service.updateTnved([{ offer: '1', goodscode: '1', current: null, base: 'x', markRequired: false, ok: false }]);

        expect(res).toEqual([{ offer: '1', error: expect.stringContaining('не реализована') }]);
    });
});
