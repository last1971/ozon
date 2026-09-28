import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WbCardWriter } from './wb.card.writer';
import { WbContentGate } from './wb.content.gate';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';

describe('WbCardWriter', () => {
    const fetchWbCard = jest.fn();
    const updateCards = jest.fn();
    const rememberCard = jest.fn();
    const method = jest.fn();
    let backupDir: string;
    let writer: WbCardWriter;
    const WB_OK = { data: null, error: false, errorText: '', additionalErrors: null };
    const card = (vendorCode: string, v = 'old') => ({
        vendorCode,
        nmID: 1,
        title: v,
        sizes: [{ chrtID: 1, skus: [] }],
        photos: [],
    });
    const retitle = (offer: string, title: string) => ({ offer, edit: (c: any) => ({ ...c, title }) });

    beforeEach(() => {
        [fetchWbCard, updateCards, rememberCard, method].forEach((m) => m.mockReset());
        clearRateLimitCache();
        backupDir = mkdtempSync(join(tmpdir(), 'wb-writer-'));
        method.mockResolvedValue({ data: { items: [] } });
        fetchWbCard.mockImplementation((o: string) => Promise.resolve(card(o)));
        const config = {
            get: (k: string, def: any) =>
                k === 'WB_CARD_BACKUP_DIR' ? backupDir : k === 'WB_CARD_ERRORS_DELAY_MS' ? 0 : def,
        };
        writer = new WbCardWriter(
            { fetchWbCard, updateCards, rememberCard } as any,
            { method } as any,
            new WbContentGate(),
            config as unknown as ConfigService,
        );
    });

    afterEach(() => rmSync(backupDir, { recursive: true, force: true }));

    it('правит свежую копию карточки, бэкап «до» с меткой, записанное — в кэш', async () => {
        updateCards.mockResolvedValue([WB_OK]);

        const res = await writer.write('gtin', [retitle('1', 'new')]);

        expect(res).toEqual([{ offer: '1' }]);
        expect(fetchWbCard).toHaveBeenCalledWith('1');
        expect(updateCards.mock.calls[0][0][0].title).toBe('new');
        expect(readdirSync(backupDir)[0]).toMatch(/^gtin-.*\.json$/);
        expect(rememberCard).toHaveBeenCalledWith(expect.objectContaining({ vendorCode: '1', title: 'new' }));
    });

    it('по умолчанию одна пачка; отказ пачки ложится на все её карточки и в кэш не идёт', async () => {
        updateCards.mockResolvedValue([{ status: 'NotOk', error: { status: 400, message: 'bad' } }]);

        const res = await writer.write('tnved', [retitle('1', 'a'), retitle('2', 'b')]);

        expect(updateCards).toHaveBeenCalledTimes(1);
        expect(res.map((r) => r.error)).toEqual(['HTTP 400: bad', 'HTTP 400: bad']);
        expect(rememberCard).not.toHaveBeenCalled();
        expect(method).not.toHaveBeenCalled(); // отложенные ошибки не читаем, если ВБ ничего не принял
    });

    it('chunkSize=1: отказ по одной карточке не задевает другую', async () => {
        updateCards
            .mockResolvedValueOnce([{ status: 'NotOk', error: { status: 400, message: 'bad' } }])
            .mockResolvedValueOnce([WB_OK]);

        const res = await writer.write('gtin', [retitle('1', 'a'), retitle('2', 'b')], undefined, 1);

        expect(updateCards).toHaveBeenCalledTimes(2);
        expect(res).toEqual([{ offer: '1', error: 'HTTP 400: bad' }, { offer: '2' }]);
    });

    it('записи идут одной очередью: вторая начинается после первой', async () => {
        const order: string[] = [];
        updateCards.mockImplementation(async (cards: any[]) => {
            order.push(`start ${cards[0].vendorCode}`);
            await new Promise((r) => setTimeout(r, 20));
            order.push(`end ${cards[0].vendorCode}`);
            return [WB_OK];
        });

        await Promise.all([writer.write('tnved', [retitle('1', 'a')]), writer.write('gtin', [retitle('2', 'b')])]);

        expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
    });

    it('упавшая запись не останавливает очередь', async () => {
        updateCards.mockRejectedValueOnce(new Error('сеть')).mockResolvedValueOnce([WB_OK]);

        await expect(writer.write('tnved', [retitle('1', 'a')])).rejects.toThrow('сеть');
        await expect(writer.write('gtin', [retitle('2', 'b')])).resolves.toEqual([{ offer: '2' }]);
    });

    it('карточка не прочиталась / не нашлась / правка бросила → ошибка по карточке, остальные пишутся', async () => {
        fetchWbCard.mockImplementation((o: string) =>
            o === 'x' ? Promise.reject(new Error('429')) : Promise.resolve(o === 'y' ? null : card(o)),
        );
        updateCards.mockResolvedValue([WB_OK]);

        const res = await writer.write('gtin', [
            retitle('x', 'a'),
            retitle('y', 'b'),
            {
                offer: 'z',
                edit: () => {
                    throw new Error('два размера');
                },
            },
            retitle('ok', 'c'),
        ]);

        expect(res).toEqual([
            { offer: 'x', error: 'карточка не прочитана с ВБ: 429' },
            { offer: 'y', error: 'карточка не найдена на ВБ' },
            { offer: 'z', error: 'правка не применена: два размера' },
            { offer: 'ok' },
        ]);
        expect(updateCards.mock.calls[0][0].map((c: any) => c.vendorCode)).toEqual(['ok']);
    });
});
