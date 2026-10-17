import { profitCheckMessage } from './formatters';

const item = (level: string, over: any = {}) => ({
    posting: '6057334305',
    level,
    payload: { service: 'WB', invoiceNumber: 21016 },
    verdicts: [
        {
            offer_id: '553603',
            units: 1,
            level,
            pricePerUnit: 4692,
            minPrice: 5100,
            cost: 3300,
            costSource: 'приход',
            profitPerUnit: -120,
            profitTotal: -120,
        },
    ],
    ...over,
});

describe('profitCheckMessage', () => {
    it('тревога — с пушем, в теме число заказов без прибыли', () => {
        const m = profitCheckMessage([item('alert'), item('warn')]);
        expect(m.notice).toBe(false);
        expect(m.subject).toBe('Заказ без прибыли: 1, ниже минимальной 1');
        expect(m.text).toContain('🔴 ПРИБЫЛИ НЕТ: 1');
        expect(m.text).toContain('WB 6057334305 · счёт №21016');
        expect(m.text).toContain(
            '553603 × 1: цена 4692, мин 5100, себестоимость 3300 (приход), прибыль -120 за шт, итого -120',
        );
    });

    it('одни предупреждения — тихо; «не проверено» с причиной', () => {
        const m = profitCheckMessage([
            item('warn'),
            item('skip', { verdicts: undefined, reason: 'площадка не отдала нашу цену за 3 ч' }),
        ]);
        expect(m.notice).toBe(true);
        expect(m.subject).toBe('Заказы ниже минимальной цены: 1');
        expect(m.text).toContain('⚪ Не проверено: 1');
        expect(m.text).toContain('  площадка не отдала нашу цену за 3 ч');
    });
});
