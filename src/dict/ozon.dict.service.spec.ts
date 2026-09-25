import { parseOzonTnvedValues } from './ozon.dict.service';

describe('parseOzonTnvedValues', () => {
    it('код из начала значения, маркируемость по метке, дубли кода схлопываются', () => {
        const entries = parseOzonTnvedValues([
            { value: '8504409100 - МАРКИРОВКА РФ - Преобразователи' },
            { value: '8504409100 - Преобразователи' },
            { value: '8532220000 - Конденсаторы' },
            { value: 'мусор без кода' },
            {},
        ]);
        expect(entries).toEqual([
            { tnved: '8504409100', isKiz: true },
            { tnved: '8532220000', isKiz: false },
        ]);
    });
});
