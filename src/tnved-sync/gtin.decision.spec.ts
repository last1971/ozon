import { checkGtinOffers } from './gtin.decision';
import { BarcodeOffer, GtinBaseItem } from '../interfaces/i.gtin.sync';

describe('checkGtinOffers — общее решение режима GTIN', () => {
    const row = (goodscode: string, gtins: string[]): GtinBaseItem => ({ goodscode, gtins });
    const offer = (o: string, barcodes: string[] = [], extra: Partial<BarcodeOffer> = {}): BarcodeOffer => ({
        offer: o,
        barcodes,
        name: `N-${o}`,
        ...extra,
    });
    const map = (entries: [string, BarcodeOffer[]][]) => new Map(entries);

    it('целевая — минимальная фасовка; не хватает — в add и reason; прогресс «сверка»', () => {
        const progress = { done: 0, counters: {} };
        const res = checkGtinOffers(
            [row('569593', ['04600000000011', '04600000000028'])],
            map([
                [
                    '569593',
                    [offer('569593-10'), offer('569593-5', ['OZN2']), offer('569593', ['OZN1', '4600000000028'])],
                ],
            ]),
            progress,
        );

        expect(res.items).toEqual([
            expect.objectContaining({
                offer: '569593',
                ok: false,
                add: ['04600000000011'], // второй GTIN уже стоит (13 знаков)
                current: 'OZN1, 4600000000028',
                base: '04600000000011, 04600000000028',
                reason: 'нет в баркодах: 04600000000011',
            }),
        ]);
        expect(progress).toMatchObject({ phase: 'сверка', done: 1, total: 1 });
    });

    it('всё стоит → ok, даже если карточка спорная для записи', () => {
        const res = checkGtinOffers(
            [row('1', ['00400001759547'])],
            map([['1', [offer('1', ['0400001759547'], { ambiguousReason: 'нет SKU' })]]]),
        );

        expect(res.items[0]).toMatchObject({ ok: true, add: [] });
        expect(res.items[0].ambiguousReason).toBeUndefined();
    });

    it('не хватает, а карточка спорная (нет SKU / несколько размеров) → ambiguousReason площадки', () => {
        const res = checkGtinOffers(
            [row('1', ['111'])],
            map([['1', [offer('1', [], { ambiguousReason: 'нет SKU' })]]]),
        );

        expect(res.items[0]).toMatchObject({ ok: false, ambiguousReason: 'нет SKU' });
    });

    it('GTIN уже на другой фасовке товара → спорно с указанием, где висит', () => {
        const res = checkGtinOffers([row('1', ['111', '222'])], map([['1', [offer('1'), offer('1-10', ['0111'])]]]));

        expect(res.items[0].ambiguousReason).toContain('111 уже на 1-10');
        expect(res.items[0].ambiguousReason).toContain('сначала снять там');
    });

    it('у товара нет карточек → notFound', () => {
        const res = checkGtinOffers([row('1', ['111']), row('2', ['222'])], map([['1', [offer('1', ['111'])]]]));

        expect(res.notFound).toEqual(['2']);
        expect(res.items).toHaveLength(1);
    });

    it('marketId целевой карточки уходит в решение (Озон пишет по SKU)', () => {
        const res = checkGtinOffers([row('1', ['111'])], map([['1', [offer('1', [], { marketId: 3322443266 })]]]));

        expect(res.items[0].marketId).toBe(3322443266);
    });
});
