import { evaluateLine, worstLevel } from './profit-check.calculator';
import { IPriceable } from '../../interfaces/i.priceable';

/** HDR-100-24 (568615), опт, 17.10.2026: приход 832,25; наценки 7/20/50; комиссия 27+1; доставка 80; упаковка 8. */
const hdr: IPriceable = {
    offer_id: '568615',
    incoming_price: 832.25,
    available_price: 0,
    fbs_direct_flow_trans_max_amount: 80,
    sales_percent: 28,
    min_perc: 7,
    perc: 20,
    old_perc: 50,
    adv_perc: 1,
    sum_pack: 8,
};
const coeffs = { minMil: 0, percMil: 0, percEkv: 0, sumObtain: 30, sumLabel: 4, taxUnit: 0 };

describe('evaluateLine', () => {
    it('цена с автоакции 1197 — прибыли нет → тревога; себестоимость из прихода', () => {
        const v = evaluateLine({ offer_id: '568615', units: 1, pricePerUnit: 1197.11 }, hdr, coeffs, 1);
        expect(v.level).toBe('alert');
        expect(v.profitPerUnit).toBeLessThan(0);
        expect(v.costSource).toBe('приход');
        expect(v.cost).toBe(832.25);
        expect(v.minPrice).toBeGreaterThan(1197);
    });

    it('цена 1837 (поставлена руками) — прибыль есть и выше минимальной → норма', () => {
        const v = evaluateLine({ offer_id: '568615', units: 2, pricePerUnit: 1837 }, hdr, coeffs, 1);
        expect(v.level).toBe('ok');
        expect(v.profitPerUnit).toBeGreaterThan(0);
        expect(v.profitTotal).toBeCloseTo(v.profitPerUnit * 2, 1);
    });

    it('ниже минимальной больше чем на 1%, но с прибылью → предупреждение; в пределах 1% → норма', () => {
        const min = evaluateLine({ offer_id: '568615', units: 1, pricePerUnit: 1837 }, hdr, coeffs, 1).minPrice;
        expect(evaluateLine({ offer_id: '568615', units: 1, pricePerUnit: min * 0.97 }, hdr, coeffs, 1).level).toBe(
            'warn',
        );
        expect(evaluateLine({ offer_id: '568615', units: 1, pricePerUnit: min * 0.995 }, hdr, coeffs, 1).level).toBe(
            'ok',
        );
    });

    it('доступная цена перебивает приход и так и подписывается', () => {
        const v = evaluateLine(
            { offer_id: '568615', units: 1, pricePerUnit: 1491 },
            { ...hdr, available_price: 659 },
            coeffs,
            1,
        );
        expect(v.costSource).toBe('доступная цена');
        expect(v.cost).toBe(659);
        expect(v.level).toBe('ok');
    });

    it('нет данных или себестоимости → не проверено', () => {
        expect(evaluateLine({ offer_id: 'x', units: 1, pricePerUnit: 100 }, undefined, coeffs, 1).level).toBe('skip');
        expect(
            evaluateLine({ offer_id: 'x', units: 1, pricePerUnit: 100 }, { ...hdr, incoming_price: 0 }, coeffs, 1)
                .reason,
        ).toBe('нет себестоимости');
        expect(evaluateLine({ offer_id: 'x', units: 1, pricePerUnit: 0 }, hdr, coeffs, 1).reason).toBe(
            'нет цены продажи',
        );
    });
});

describe('worstLevel', () => {
    it('худший из строк; «не проверено» уровень не поднимает', () => {
        expect(worstLevel(['ok', 'warn', 'skip'])).toBe('warn');
        expect(worstLevel(['warn', 'alert'])).toBe('alert');
        expect(worstLevel(['skip', 'skip'])).toBe('skip');
        expect(worstLevel(['ok', 'skip'])).toBe('ok');
        expect(worstLevel([])).toBe('ok');
    });
});
