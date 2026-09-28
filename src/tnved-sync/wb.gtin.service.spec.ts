import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WbGtinService } from './wb.gtin.service';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbCardWriter } from '../wb.card/wb.card.writer';
import { WbContentGate } from '../wb.card/wb.content.gate';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';

describe('WbGtinService', () => {
    let service: WbGtinService;
    const getAllWbCards = jest.fn();
    const fetchWbCard = jest.fn();
    const updateCards = jest.fn();
    const rememberCard = jest.fn();
    const method = jest.fn();
    let backupDir: string;
    const WB_OK = { data: null, error: false, errorText: '', additionalErrors: null };

    const card = (vendorCode: string, skus: string[] | string[][] = []) => ({
        nmID: 1,
        vendorCode,
        title: `PROD-${vendorCode}`,
        characteristics: [{ id: 15000001, value: ['8504408300'] }],
        sizes: (Array.isArray(skus[0]) ? (skus as string[][]) : [skus as string[]]).map((s, i) => ({ chrtID: i + 1, skus: s })),
        photos: [],
    });
    const row = (goodscode: string, gtins: string[]) => ({ goodscode, gtins });

    beforeEach(async () => {
        [getAllWbCards, fetchWbCard, updateCards, rememberCard, method].forEach((m) => m.mockReset());
        clearRateLimitCache();
        backupDir = mkdtempSync(join(tmpdir(), 'wb-gtin-'));
        method.mockResolvedValue({ data: { items: [] } }); // cards/error/list — отказов нет
        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                WbGtinService,
                WbCardWriter,
                WbContentGate,
                { provide: WbCardService, useValue: { getAllWbCards, fetchWbCard, updateCards, rememberCard } },
                { provide: WbApiService, useValue: { method } },
                { provide: ConfigService, useValue: { get: (k: string, def: any) => (k === 'WB_CARD_BACKUP_DIR' ? backupDir : k === 'WB_CARD_ERRORS_DELAY_MS' ? 0 : def) } },
            ],
        }).compile();
        service = moduleRef.get(WbGtinService);
    });

    afterEach(() => rmSync(backupDir, { recursive: true, force: true }));

    it('check: баркоды — skus размеров; целевая — минимальная фасовка; несколько размеров — спорно', async () => {
        getAllWbCards.mockResolvedValue([card('1-10', ['201']), card('1', ['200']), card('2', [['300'], ['301']])]);

        const res = await service.check([row('1', ['04600000000011']), row('2', ['04600000000028'])]);

        expect(res.items.map((i) => [i.offer, i.ok, i.add, i.ambiguousReason ?? null])).toEqual([
            ['1', false, ['04600000000011'], null],
            ['2', false, ['04600000000028'], 'у карточки размеров: 2 — в какой писать баркод, неясно'],
        ]);
    });

    it('update: GTIN — в конец skus свежей карточки, по одной карточке в cards/update, кэш обновляется', async () => {
        fetchWbCard.mockImplementation((o: string) => Promise.resolve(card(o, ['2000000000011'])));
        updateCards.mockResolvedValue([WB_OK]);
        const progress = { done: 0, counters: {} };
        const item = (offer: string, add: string[]) => ({ offer, goodscode: offer, current: null, base: '', ok: false, add });

        const res = await service.update([item('1', ['04600000000011', '2000000000011']), item('2', ['04600000000028'])], progress);

        expect(res).toEqual([{ offer: '1' }, { offer: '2' }]);
        expect(updateCards).toHaveBeenCalledTimes(2); // по одной
        expect(updateCards.mock.calls[0][0][0].sizes[0].skus).toEqual(['2000000000011', '04600000000011']); // первый не сдвинут, дубль не добавлен
        expect(updateCards.mock.calls[0][0][0].characteristics).toEqual([{ id: 15000001, value: ['8504408300'] }]); // остальное — как на ВБ
        expect(rememberCard).toHaveBeenCalledTimes(2);
        expect(progress).toMatchObject({ phase: 'запись', done: 2, total: 2 });
    });

    it('update: у свежей карточки стало несколько размеров → ошибка по карточке, в ВБ не уходит', async () => {
        fetchWbCard.mockResolvedValue(card('1', [['1'], ['2']]));

        const res = await service.update([{ offer: '1', goodscode: '1', current: null, base: '', ok: false, add: ['111'] }]);

        expect(res[0].error).toContain('правка не применена');
        expect(updateCards).not.toHaveBeenCalled();
    });
});
