import { extractKi } from './mark.scan.util';
import { BadRequestException } from '@nestjs/common';

describe('extractKi', () => {
    const KI = '010460005100005721ABCDEFGHIJKLM';

    it('чистый KI возвращается как есть', () => {
        expect(extractKi(KI)).toBe(KI);
    });

    it('обрезает крипто-хвост по GS (\\u001d)', () => {
        expect(extractKi(KI + '93dGVz')).toBe(KI);
    });

    it('обрезает крипто-хвост по альтернативному GS (\\u0093)', () => {
        expect(extractKi(KI + 'ABCD')).toBe(KI);
    });

    it('обрезает крипто-хвост по паре 91(ключ)92', () => {
        const long = KI + '91EE0692dGVzdA';
        expect(extractKi(long)).toBe(KI);
    });

    it('ключ между 91 и 92 — любые 4 символа', () => {
        const long = KI + '91ZZ0092base64crypto';
        expect(extractKi(long)).toBe(KI);
    });

    it('режет по первой встреченной паре 91..92', () => {
        const long = KI + '91AAAA9291BBBB92';
        expect(extractKi(long)).toBe(KI);
    });

    it('обрезает плоский крипто-хвост 93(ключ4) без разделителя', () => {
        expect(extractKi(KI + '93dGVz')).toBe(KI);
    });

    it('не режет "93" внутри серийника, если это не конец строки', () => {
        // "93" стоит в серийнике, но после него ещё есть данные -> не хвост
        const withMid93 = KI.slice(0, -2) + '93' + '91EE0692crypto';
        expect(extractKi(withMid93)).toBe(KI.slice(0, -2) + '93');
    });

    it('реальный код 569740 с хвостом 93 режется до чистого KI(38)', () => {
        const raw = '0104711287492735215)M/1CtML//vOkRKWW(l935hXm';
        expect(extractKi(raw)).toBe('0104711287492735215)M/1CtML//vOkRKWW(l');
    });

    it('обрезает trim пробелы', () => {
        expect(extractKi('  ' + KI + '  ')).toBe(KI);
    });

    it('бросает на пустой ввод', () => {
        expect(() => extractKi('')).toThrow(BadRequestException);
    });

    it('бросает если не начинается на 01', () => {
        expect(() => extractKi('99' + KI.slice(2))).toThrow(BadRequestException);
    });

    it('бросает на слишком короткой строке', () => {
        expect(() => extractKi('0100')).toThrow(BadRequestException);
    });

    it('бросает на слишком длинной строке (>50 без сепараторов)', () => {
        const trash = '0' + '1'.repeat(60);
        expect(() => extractKi(trash)).toThrow(BadRequestException);
    });
});
