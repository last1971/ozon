import { parseTnved, serializeTnved } from './wb-tnved.codec';

describe('wb-tnved.codec', () => {
    it('маркируемый код помечается звёздочкой, пустые выбрасываются', () => {
        expect(
            serializeTnved([
                { tnved: ' 8504408300 ', isKiz: true },
                { tnved: '8532220000', isKiz: false },
                { tnved: '', isKiz: false },
            ]),
        ).toBe('8504408300*,8532220000');
    });

    it('разбор — обратная операция', () => {
        expect(parseTnved('8504408300*,8532220000')).toEqual([
            { tnved: '8504408300', isKiz: true },
            { tnved: '8532220000', isKiz: false },
        ]);
        expect(parseTnved('')).toEqual([]);
        expect(parseTnved(null)).toEqual([]);
    });
});
