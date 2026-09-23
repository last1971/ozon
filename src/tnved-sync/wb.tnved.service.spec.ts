import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbTnvedService } from './wb.tnved.service';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';

describe('WbTnvedService', () => {
    let service: WbTnvedService;
    const getAllWbCards = jest.fn();
    const fetchCharacteristics = jest.fn();
    const getWbCardAsync = jest.fn();
    const updateCards = jest.fn();
    const method = jest.fn();
    let backupDir: string;

    const SUBJECT = 2009; // «Блоки питания»
    const TNVED_CHARC = { charcID: 15000001, name: 'ТНВЭД', required: false, unitName: '', maxCount: 1, popular: false, charcType: 1 };
    const DIRECTORY = { data: [{ tnved: '8504403003', isKiz: false }, { tnved: '8504408300', isKiz: false }] };

    // карточка ВБ: tnved — значение характеристики 15000001 (undefined = характеристики нет)
    const card = (vendorCode: string, tnved?: string | string[], subjectID = SUBJECT, needKiz = true, kizMarked = needKiz) => ({
        nmID: 1,
        needKiz,
        kizMarked,
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
        [getAllWbCards, fetchCharacteristics, getWbCardAsync, updateCards, method].forEach((m) => m.mockReset());
        clearRateLimitCache();
        backupDir = mkdtempSync(join(tmpdir(), 'wb-tnved-'));
        fetchCharacteristics.mockResolvedValue({ data: [TNVED_CHARC], error: false });
        method.mockResolvedValue(DIRECTORY);
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                WbTnvedService,
                { provide: WbCardService, useValue: { getAllWbCards, fetchCharacteristics, getWbCardAsync, updateCards } },
                { provide: WbApiService, useValue: { method } },
                { provide: ConfigService, useValue: { get: (k: string, def: any) => (k === 'WB_CARD_BACKUP_DIR' ? backupDir : def) } },
            ],
        }).compile();
        service = moduleRef.get(WbTnvedService);
    });

    afterEach(() => rmSync(backupDir, { recursive: true, force: true }));

    it('код совпадает → ok', async () => {
        getAllWbCards.mockResolvedValue([card('565831', ['8504408300'])]);

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items).toHaveLength(1);
        expect(res.items[0]).toMatchObject({ offer: '565831', current: '8504408300', ok: true });
        expect(res.notFound).toEqual([]);
    });

    it('код совпал, но needKiz не по базе → на правку (маркируемый, галочка выкл)', async () => {
        getAllWbCards.mockResolvedValue([card('474754', '8504408300', SUBJECT, false)]);

        const res = await service.checkTnved([base('474754', '8504408300', true)]);

        expect(res.items[0].ok).toBe(false);
        expect(res.items[0].reason).toBe('включить код маркировки; подтвердить маркировку');
    });

    it('маркируемый: needKiz есть, подтверждения маркировки нет → на правку «подтвердить»', async () => {
        getAllWbCards.mockResolvedValue([card('474754', '8504408300', SUBJECT, true, false)]);

        const res = await service.checkTnved([base('474754', '8504408300', true)]);

        expect(res.items[0].ok).toBe(false);
        expect(res.items[0].reason).toBe('подтвердить маркировку');
    });

    it('немаркируемый с галочкой → на правку «выключить»', async () => {
        getAllWbCards.mockResolvedValue([card('376743', '8532220000', SUBJECT, true)]);
        method.mockResolvedValue({ data: [{ tnved: '8532220000', isKiz: false }] });

        const res = await service.checkTnved([base('376743', '8532220000', false)]);

        expect(res.items[0].reason).toBe('выключить код маркировки; снять подтверждение маркировки');
    });

    it('код другой → на правку с причиной', async () => {
        getAllWbCards.mockResolvedValue([card('565831', '8504403003')]);

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items[0]).toMatchObject({ ok: false, current: '8504403003', base: '8504408300' });
        expect(res.items[0].reason).toBe('ТНВЭД 8504403003→8504408300');
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

    it('429 на справочнике → ждём retryAfterMs и повторяем, результат как обычно', async () => {
        getAllWbCards.mockResolvedValue([card('565831', '8504408300')]);
        method
            .mockResolvedValueOnce({ result: null, status: 'NotOk', error: { status: 429, retryAfterMs: 20 } })
            .mockResolvedValueOnce(DIRECTORY);

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(method).toHaveBeenCalledTimes(2);
        expect(res.items[0].ok).toBe(true);
    });

    it('характеристики предмета не отданы (429 три раза подряд) → спорно «не отданы», не «нет характеристики»', async () => {
        getAllWbCards.mockResolvedValue([card('565831', '8504408300')]);
        fetchCharacteristics.mockResolvedValue({ result: null, status: 'NotOk', error: { status: 429, retryAfterMs: 10 } });

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(fetchCharacteristics).toHaveBeenCalledTimes(4); // 1 + 3 повтора
        expect(res.items[0].ambiguousReason).toContain('не отданы');
        expect(method).not.toHaveBeenCalled();
    });

    it('429 на характеристиках → пауза и повтор, дальше как обычно', async () => {
        getAllWbCards.mockResolvedValue([card('565831', '8504408300')]);
        fetchCharacteristics
            .mockResolvedValueOnce({ result: null, status: 'NotOk', error: { status: 429, retryAfterMs: 10 } })
            .mockResolvedValueOnce({ data: [TNVED_CHARC], error: false });

        const res = await service.checkTnved([base('565831', '8504408300')]);

        expect(res.items[0].ok).toBe(true);
    });

    it('у предмета нет характеристики ТНВЭД → спорно, справочник не запрашиваем', async () => {
        getAllWbCards.mockResolvedValue([card('565831', undefined, 964)]);
        fetchCharacteristics.mockResolvedValue({ data: [{ ...TNVED_CHARC, charcID: 15004139, name: 'Код ТН ВЭД' }], error: false });

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
        expect(fetchCharacteristics).toHaveBeenCalledTimes(1);
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

    describe('updateTnved', () => {
        const fix = (offer: string, base = '8504408300', markRequired = true) => ({ offer, goodscode: offer, current: null, base, markRequired, ok: false });
        const WB_OK = { data: null, error: false, errorText: '', additionalErrors: null };

        it('пишет копию карточки с нашим кодом в характеристике, оригинал не трогает', async () => {
            const original = { ...card('565831', '8504403003', SUBJECT, false), documents: [{ id: 1 }] } as any; // поле вне DTO должно уехать
            getWbCardAsync.mockResolvedValue(original);
            updateCards.mockResolvedValue([WB_OK]);

            const res = await service.updateTnved([fix('565831')]);

            expect(res).toEqual([{ offer: '565831' }]);
            const sent = updateCards.mock.calls[0][0];
            expect(sent).toHaveLength(1);
            expect(sent[0].characteristics).toEqual([{ id: 15000001, name: 'ТНВЭД', value: ['8504408300'] }]);
            expect(sent[0].documents).toEqual([{ id: 1 }]);
            expect(sent[0].needKiz).toBe(true);
            expect(sent[0].kizMarked).toBe(true);
            expect(original.characteristics[0].value).toBe('8504403003');
            expect(original.needKiz).toBe(false);
        });

        it('характеристики не было — добавляет; немаркируемый → needKiz false', async () => {
            getWbCardAsync.mockResolvedValue(card('565831'));
            updateCards.mockResolvedValue([WB_OK]);

            await service.updateTnved([fix('565831', '8504408300', false)]);

            const sent = updateCards.mock.calls[0][0][0];
            expect(sent.characteristics).toEqual([{ id: 15000001, value: ['8504408300'] }]);
            expect(sent.needKiz).toBe(false);
            expect(sent.kizMarked).toBe(false);
        });

        it('перед записью кладёт карточки «до» в файл', async () => {
            getWbCardAsync.mockResolvedValue(card('565831', '8504403003'));
            updateCards.mockResolvedValue([WB_OK]);

            await service.updateTnved([fix('565831')]);

            const files = readdirSync(backupDir);
            expect(files).toHaveLength(1);
            expect(files[0]).toMatch(/^tnved-.*\.json$/);
            const saved = JSON.parse(readFileSync(join(backupDir, files[0]), 'utf8'));
            expect(saved[0].characteristics[0].value).toBe('8504403003');
        });

        it('HTTP-отказ ВБ ({status:NotOk}) → error на каждую карточку', async () => {
            getWbCardAsync.mockResolvedValue(card('565831'));
            updateCards.mockResolvedValue([{ result: null, status: 'NotOk', error: { status: 400, message: 'bad' } }]);

            const res = await service.updateTnved([fix('565831')]);

            expect(res[0].error).toContain('HTTP 400: bad');
        });

        it('принято с ошибкой ({error:true, errorText}) → error с additionalErrors', async () => {
            getWbCardAsync.mockResolvedValue(card('565831'));
            updateCards.mockResolvedValue([{ data: null, error: true, errorText: 'Ошибка', additionalErrors: { x: 1 } }]);

            const res = await service.updateTnved([fix('565831')]);

            expect(res[0].error).toContain('Ошибка');
            expect(res[0].error).toContain('"x":1');
        });

        it('карточки нет на ВБ → error, запись не вызывается', async () => {
            getWbCardAsync.mockResolvedValue(null);

            const res = await service.updateTnved([fix('нет')]);

            expect(res).toEqual([{ offer: 'нет', error: expect.stringContaining('не найдена') }]);
            expect(updateCards).not.toHaveBeenCalled();
            expect(readdirSync(backupDir)).toHaveLength(0);
        });
    });
});
