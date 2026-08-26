import {
    donorSuffixFor,
    MP_ORDER_CANCELLATION_SUFFIX,
    OZON_INVOICE_CLOSED_SUFFIX,
    splitInvoicePrim,
} from './order.cancellation.constants';

describe('order.cancellation.constants', () => {
    describe('splitInvoicePrim — единственный разбор PRIM на номер и пометку', () => {
        it('чистый номер: пометки нет', () => {
            expect(splitInvoicePrim('01713732-0274-1')).toEqual({ posting: '01713732-0274-1', mark: '' });
        });

        it.each([
            [MP_ORDER_CANCELLATION_SUFFIX.REGULAR],
            [MP_ORDER_CANCELLATION_SUFFIX.FBO],
            [MP_ORDER_CANCELLATION_SUFFIX.WBFBO],
            [OZON_INVOICE_CLOSED_SUFFIX],
            [' возврат WBFBO'], // легаси-пометка, её тоже надо узнавать
        ])('пометка «%s» отрезается, номер остаётся целым', (suffix) => {
            expect(splitInvoicePrim(`01713732-0274-1${suffix}`)).toEqual({
                posting: '01713732-0274-1',
                mark: suffix,
            });
        });

        it('« отмена FBO» не путается с « отмена»: берётся длинный суффикс', () => {
            const res = splitInvoicePrim(`555-1${MP_ORDER_CANCELLATION_SUFFIX.FBO}`);
            expect(res.mark).toBe(MP_ORDER_CANCELLATION_SUFFIX.FBO);
            expect(res.posting).toBe('555-1');
        });

        it('неизвестный хвост пометкой не считается — уедет в номер и не сматчится', () => {
            expect(splitInvoicePrim('555-1 возврат в пути')).toEqual({
                posting: '555-1 возврат в пути',
                mark: '',
            });
        });

        it('составной хвост снимается целиком: « отмена FBO закрыт» — штатная строка', () => {
            const prim = `01713732-0274-1${MP_ORDER_CANCELLATION_SUFFIX.FBO}${OZON_INVOICE_CLOSED_SUFFIX}`;
            expect(splitInvoicePrim(prim)).toEqual({
                posting: '01713732-0274-1',
                mark: `${MP_ORDER_CANCELLATION_SUFFIX.FBO}${OZON_INVOICE_CLOSED_SUFFIX}`,
            });
        });

        it('пустое и пробельное значение не роняют разбор', () => {
            expect(splitInvoicePrim('')).toEqual({ posting: '', mark: '' });
            expect(splitInvoicePrim('   ')).toEqual({ posting: '', mark: '' });
            expect(splitInvoicePrim(undefined as unknown as string)).toEqual({ posting: '', mark: '' });
        });
    });

    describe('donorSuffixFor', () => {
        it('ВБ получает свой суффикс, остальные — озоновский', () => {
            expect(donorSuffixFor('WB')).toBe(MP_ORDER_CANCELLATION_SUFFIX.WBFBO);
            expect(donorSuffixFor('OZON')).toBe(MP_ORDER_CANCELLATION_SUFFIX.FBO);
            expect(donorSuffixFor(undefined)).toBe(MP_ORDER_CANCELLATION_SUFFIX.FBO);
        });
    });
});
