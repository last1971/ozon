import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OzonPricingResult from '../OzonPricingResult.vue';
it('расходы Ozon показывают все новые компоненты потерь, без повторного вычитания возмещения', () => {
    const w = mount(OzonPricingResult, {
        props: {
            result: {
                offerId: '123',
                baseSource: 'remaining-lots',
                base: 100,
                min: null,
                normal: null,
                max: null,
                current: null,
                costs: { returns: 4, cancellations: 2, sellerReturns: 3, defects: 5, defectCompensation: 1 },
            } as any,
        },
        global: {
            stubs: {
                VTable: true,
                VRow: { template: '<div><slot /></div>' },
                VCol: { template: '<div><slot /></div>' },
            },
        },
    });
    expect(w.find('details').text()).toContain('Доставка при отказах: 2 ₽');
    expect(w.find('details').text()).toContain('Возврат продавцу: 3 ₽');
    expect(w.find('details').text()).toContain('Чистый резерв брака: 5 ₽');
    expect(w.find('details').text()).toContain('Уже учтённое возмещение брака: 1 ₽');
});
