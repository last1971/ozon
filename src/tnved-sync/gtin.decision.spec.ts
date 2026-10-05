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

    it('GTIN уже на другой фасовке → держатель она, ей и дописываем остальные GTIN; мин. фасовку не трогаем', () => {
        const res = checkGtinOffers([row('1', ['111', '222'])], map([['1', [offer('1'), offer('1-10', ['0111'])]]]));

        expect(res.items).toEqual([
            expect.objectContaining({ offer: '1-10', slot: 'barcodes', add: ['222'], reason: 'нет в баркодах: 222' }),
        ]);
    });

    it('GTIN разъехались по двум карточкам → спорно с указанием, где висит', () => {
        const res = checkGtinOffers(
            [row('1', ['111', '222'])],
            map([['1', [offer('1', ['0111']), offer('1-10', ['0222'])]]]),
        );

        expect(res.items[0]).toMatchObject({ offer: '1', slot: 'barcodes' });
        expect(res.items[0].ambiguousReason).toContain('222 уже на 1-10');
        expect(res.items[0].ambiguousReason).toContain('сначала снять там');
    });

    it('площадка с полем «дополнительный GTIN» (extraSlot): остальным фасовкам — GTIN держателя в extra', () => {
        const res = checkGtinOffers(
            [row('1', ['111', '222'])],
            map([
                [
                    '1',
                    [
                        offer('1', ['OZN1'], { extraSlot: true }),
                        offer('1-5', ['OZN5'], { extraSlot: true, extraGtin: '0111' }),
                        offer('1-10', ['OZN10'], { extraSlot: true, extraGtin: null }),
                        offer('1-20', ['OZN20', '0222'], { extraSlot: true }),
                    ],
                ],
            ]),
        );

        // держатель — 1-20 (уже держит 222): ему 111 в баркоды; 1-5 ok (extra = 111); 1 и 1-10 — extra 222
        expect(res.items.map((i) => [i.offer, i.slot, i.ok, i.add, i.ambiguousReason ?? null])).toEqual([
            ['1-20', 'barcodes', false, ['111'], null],
            ['1', 'extra', false, ['222'], null],
            ['1-5', 'extra', true, [], null],
            ['1-10', 'extra', false, ['222'], null],
        ]);
        expect(res.items[1]).toMatchObject({ current: null, action: 'дополнительный GTIN 222' });
    });

    it('держатель без GTIN: остальным в extra уходит первый GTIN базы — тот же, что получит держатель', () => {
        const res = checkGtinOffers(
            [row('1', ['111', '222'])],
            map([['1', [offer('1', ['OZN1'], { extraSlot: true }), offer('1-10', ['OZN10'], { extraSlot: true })]]]),
        );

        expect(res.items.map((i) => [i.offer, i.slot, i.add])).toEqual([
            ['1', 'barcodes', ['111', '222']],
            ['1-10', 'extra', ['111']],
        ]);
    });

    it('площадка без поля extra (Озон): остальные фасовки не трогаем, как раньше', () => {
        const res = checkGtinOffers([row('1', ['111'])], map([['1', [offer('1'), offer('1-10', ['OZN10'])]]]));

        expect(res.items).toHaveLength(1);
        expect(res.items[0]).toMatchObject({ offer: '1', slot: 'barcodes', add: ['111'] });
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
