import { buildOzonRoutes, selectOzonRoutes } from './ozon.routes';
import { PostingDto } from '../../posting/dto/posting.dto';
const from = '2026-08-07T00:00:00+03:00',
    to = '2026-11-05T00:00:00+03:00';
const posting = (id: string, offer = '123-5', quantity = 1, destination = 'Москва'): PostingDto => ({
    posting_number: id,
    in_process_at: '2026-10-01T00:00:00Z',
    status: 'delivered',
    products: [{ offer_id: offer, quantity, price: '10' }],
    financial_data: { cluster_to: destination },
});
const catalog = [
    { sku: '123-5', typeId: 1 },
    { sku: '124', typeId: 1 },
    { sku: '125', typeId: 2 },
];
const build = (postings: PostingDto[]) => buildOzonRoutes([{ scheme: 'fbs', postings }], catalog, from, to);
describe('Распределение направлений', () => {
    it('8 пачек в Москву, 2 в Казань — веса 8/2, фасовка не умножает их', () => {
        const snap = build([posting('a', '123-5', 8), posting('b', '123-5', 2, 'Казань')]);
        expect(selectOzonRoutes(snap, 'fbs', '123-5', 1)).toMatchObject({
            units: 10,
            destinations: [
                { cluster: 'Москва', units: 8 },
                { cluster: 'Казань', units: 2 },
            ],
        });
    });
    it('повторы отправления не удваивают статистику, FBS/FBO независимы', () => {
        const p = posting('a', '123-5', 3);
        const snap = buildOzonRoutes(
            [
                { scheme: 'fbs', postings: [p, p] },
                { scheme: 'fbo', postings: [p] },
            ],
            catalog,
            from,
            to,
        );
        expect(selectOzonRoutes(snap, 'fbs', '123-5').units).toBe(3);
        expect(selectOzonRoutes(snap, 'fbo', '123-5').units).toBe(3);
    });
    it('не принимает конфликт одного отправления', () => {
        expect(() => build([posting('a'), posting('a', '123-5', 2)])).toThrow('Разные данные');
    });
    it('не считает отмены и заказы вне окна; нижняя граница включена, верхняя исключена', () => {
        expect(
            selectOzonRoutes(
                build([
                    { ...posting('cancel'), status: 'cancelled' },
                    { ...posting('old'), in_process_at: '2026-08-06T00:00:00Z' },
                    { ...posting('start'), in_process_at: from },
                    { ...posting('end'), in_process_at: to },
                ]),
                'fbs',
                '123-5',
            ).units,
        ).toBe(1);
    });
    it('при малой истории использует свой тип; без достаточной истории категории — null', () => {
        const snap = build([posting('a', '123-5', 2), posting('b', '124', 8), posting('c', '125', 20, 'Казань')]);
        expect(selectOzonRoutes(snap, 'fbs', '123-5', 1, 5).scope).toBe('type');
        expect(selectOzonRoutes(snap, 'fbs', '123-5', 1, 15)).toBeNull();
        expect(selectOzonRoutes(snap, 'fbs', '124', 1, 8).scope).toBe('offer');
        expect(selectOzonRoutes(snap, 'fbo', '124', 1)).toBeNull();
    });
    it('не теряет вес заказа с неизвестным направлением', () => {
        const snap = build([posting('a', '123-5', 2, '')]);
        expect(snap.missingDirections).toBe(2);
        expect(selectOzonRoutes(snap, 'fbs', '123-5').destinations).toEqual([{ cluster: '', units: 2 }]);
    });
    it.each([0, -1, 1.2, NaN, Infinity])('не принимает количество %s', (quantity) => {
        expect(() => build([posting('a', '123-5', quantity)])).toThrow();
    });
    it.each([0, -1, 1.2, NaN])('не принимает порог %s', (min) => {
        expect(() => selectOzonRoutes(build([]), 'fbs', '123', 1, min)).toThrow();
    });
    it('отклоняет неверные даты, пустые товары и переполнение', () => {
        expect(() => build([{ ...posting('a'), in_process_at: 'bad' }])).toThrow();
        expect(() => build([{ ...posting('a'), products: [] }])).toThrow();
        expect(() => build([posting('a', '123-5', Number.MAX_SAFE_INTEGER), posting('b')])).toThrow();
    });
});

it('чужая категория и общая история кабинета не подставляются вместо своей категории', () => {
    const snapshot = build([posting('other', '125', 10)]);
    expect(selectOzonRoutes(snapshot, 'fbs', '123-5', 1)).toBeNull();
});

it('средние категории FBS и FBO берутся из разных историй', () => {
    const snapshot = buildOzonRoutes(
        [
            { scheme: 'fbs', postings: [posting('a', '124', 8, 'Москва')] },
            { scheme: 'fbo', postings: [posting('b', '124', 2, 'Казань')] },
        ],
        catalog,
        from,
        to,
    );
    expect(selectOzonRoutes(snapshot, 'fbs', '123-5', 1)).toMatchObject({
        scope: 'type',
        units: 8,
        destinations: [{ cluster: 'Москва', units: 8 }],
    });
    expect(selectOzonRoutes(snapshot, 'fbo', '123-5', 1)).toMatchObject({
        scope: 'type',
        units: 2,
        destinations: [{ cluster: 'Казань', units: 2 }],
    });
});
