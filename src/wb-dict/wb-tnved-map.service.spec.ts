import { buildTnvedMap, lookupTnved, WbTnvedMapService } from './wb-tnved-map.service';

describe('wb-tnved-map', () => {
    const rows = [
        { id: 4536, name: 'Реле напряжения', parentName: 'Электрика', commission: 35, tnved: [{ tnved: '8536411000', isKiz: false }, { tnved: '8504408300', isKiz: true }] },
        { id: 7422, name: 'Радиодетали', parentName: 'Электрика', commission: 25, tnved: [{ tnved: '8504408300', isKiz: true }, { tnved: '8541210000', isKiz: false }] },
        { id: 8648, name: 'Реле для мототехники', parentName: 'Мототовары', commission: 40, tnved: [{ tnved: '8536490000', isKiz: false }] },
    ];
    const codes = buildTnvedMap(rows);

    it('точное совпадение: предметы по комиссии, с пометкой маркировки', () => {
        const res = lookupTnved(codes, '8504408300');
        expect(res.match).toBe('exact');
        expect(res.subjects.map((s) => [s.id, s.commission, s.isKiz])).toEqual([
            [7422, 25, true],
            [4536, 35, true],
        ]);
    });

    it('точного нет → по 6 знакам, потом по 4, без повторов предметов', () => {
        const six = lookupTnved(codes, '8536419999');
        expect(six.match).toBe('prefix6');
        expect(six.subjects.map((s) => s.id)).toEqual([4536]);

        const four = lookupTnved(codes, '8536900000');
        expect(four.match).toBe('prefix4');
        expect(four.subjects.map((s) => s.id)).toEqual([4536, 8648]);
    });

    it('ничего не подходит → none; мусор в коде отбрасывается', () => {
        expect(lookupTnved(codes, '3926909709')).toEqual({ tnved: '3926909709', match: 'none', subjects: [] });
        expect(lookupTnved(codes, '8504 40 830 0').match).toBe('exact');
    });

    it('сервис собирает карту из базы при первом обращении и после rebuild', async () => {
        const listWithTnved = jest.fn().mockResolvedValue(rows);
        const service = new WbTnvedMapService({ listWithTnved } as any);

        expect((await service.find('8541210000')).subjects.map((s) => s.id)).toEqual([7422]);
        await service.find('8541210000');
        expect(listWithTnved).toHaveBeenCalledTimes(1);

        listWithTnved.mockResolvedValue(rows.slice(0, 1));
        expect(await service.rebuild()).toBe(2);
        expect((await service.find('8541210000')).match).toBe('none');
    });
});
