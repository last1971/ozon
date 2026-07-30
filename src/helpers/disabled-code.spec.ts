import { encodeDisabled, parseDisabled, isDisabled } from './disabled-code';

describe('disabled-code', () => {
    describe('encodeDisabled', () => {
        it('good → префикс, sku → как есть', () => {
            expect(encodeDisabled('11111', 'good')).toBe('good:11111');
            expect(encodeDisabled('11111', 'sku')).toBe('11111');
            expect(encodeDisabled('11111-10', 'sku')).toBe('11111-10');
        });
    });

    describe('parseDisabled', () => {
        it('разбирает обратно с уровнем', () => {
            expect(parseDisabled('good:11111')).toEqual({ code: '11111', level: 'good' });
            expect(parseDisabled('11111')).toEqual({ code: '11111', level: 'sku' });
            expect(parseDisabled('11111-10')).toEqual({ code: '11111-10', level: 'sku' });
        });
    });

    describe('isDisabled — ключевой кейс 11111 vs 11111-10', () => {
        it('sku-блок 11111 гасит только 11111, 11111-10 жив', () => {
            const set = new Set(['11111']); // sku-блок
            expect(isDisabled('11111', set)).toBe(true);
            expect(isDisabled('11111-10', set)).toBe(false);
        });

        it('good-блок 11111 гасит весь товар (и 11111, и 11111-10)', () => {
            const set = new Set(['good:11111']); // good-блок
            expect(isDisabled('11111', set)).toBe(true);
            expect(isDisabled('11111-10', set)).toBe(true);
        });

        it('sku-блок 11111-10 гасит только фасовку, штучный 11111 жив', () => {
            const set = new Set(['11111-10']);
            expect(isDisabled('11111-10', set)).toBe(true);
            expect(isDisabled('11111', set)).toBe(false);
        });

        it('11111-SKU и 11111-гудскоде не пересекаются', () => {
            expect(isDisabled('11111-10', new Set(['11111']))).toBe(false); // sku-блок 11111 не трогает фасовку
            expect(isDisabled('11111-10', new Set(['good:11111']))).toBe(true); // good-блок трогает
        });
    });
});
