import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OzonPricingResult from '../OzonPricingResult.vue';
import type { OzonPricingResultDto } from '@/contracts/ozon-pricing-result.dto';

const result = (): OzonPricingResultDto => ({
    offerId: '123-5',
    baseSource: 'remaining-lots',
    base: 100,
    min: { price: 229, profit: 20.3, commissionRate: 0.2, scheme: 'fbs' },
    normal: { price: 258, profit: 40.6, commissionRate: 0.2, scheme: 'fbs' },
    max: { price: 800, profit: 80, commissionRate: 0.5, scheme: 'fbo' },
    current: { min: 800, normal: 900, max: 1000 },
    deadZoneFloor: 650,
    costs: {
        commission: 45.8,
        delivery: 20,
        returns: 20,
        tax: 22.9,
        vat: 0,
        profitTax: 0,
        packing: 0,
        label: 0,
        handling: 0,
        advertising: 0,
        acquiring: 0,
        firstMile: 0,
        lastMile: 0,
    },
});
const render = (data?: OzonPricingResultDto, loading = false) =>
    mount(OzonPricingResult, {
        props: { result: data, loading },
        global: {
            stubs: {
                VTable: { template: '<table><slot /></table>' },
                VRow: { template: '<div><slot /></div>' },
                VCol: { template: '<div><slot /></div>' },
            },
        },
    });
describe('Отдельный блок расчётных цен', () => {
    it('показывает текущие и расчётные цены в отдельных колонках, три уровня и источник базы', () => {
        const wrapper = render(result());
        expect(wrapper.text()).toContain('Расчётная цена Ozon (формула этапа 6)');
        expect(wrapper.findAll('th').map((th) => th.text())).toEqual([
            'Уровень',
            'Текущая Ozon',
            'Расчётная',
            'Прибыль',
            'Схема',
            'Комиссия',
        ]);
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0].findAll('td').map((td) => td.text())).toEqual(['Мин', '800 ₽', '229 ₽', '20,3 ₽', 'FBS', '20%']);
        expect(rows[2].text()).toContain('FBO');
        expect(wrapper.text()).toContain('База себестоимости: Остаточные партии — 100 ₽');
        expect(wrapper.text()).toContain('≤ 300 ₽ или ≥ 650 ₽');
        expect(wrapper.find('details').text()).toContain('Возвраты: 20 ₽');
    });
    it('ошибка скрывает таблицу и устаревшие цены', () => {
        const wrapper = render({ ...result(), error: 'Нет базы себестоимости' });
        expect(wrapper.find('table').exists()).toBe(false);
        expect(wrapper.find('[role=status]').text()).toBe('Нет базы себестоимости');
        expect(wrapper.find('[role=status]').classes()).toContain('text-grey');
        expect(wrapper.find('details').exists()).toBe(false);
    });
    it('при пересчёте скрывает устаревший результат', () => {
        const wrapper = render(result(), true);
        expect(wrapper.text()).toContain('Расчёт…');
        expect(wrapper.find('table').exists()).toBe(false);
    });
    it('не выдумывает мёртвую зону и нулевую текущую цену', () => {
        const wrapper = render({ ...result(), deadZoneFloor: undefined, current: null });
        expect(wrapper.text()).not.toContain('Мёртвая зона');
        expect(wrapper.findAll('tbody tr')[0].findAll('td')[1].text()).toBe('—');
    });
    it('без данных показывает состояние ожидания', () => {
        const wrapper = render();
        expect(wrapper.text()).toContain('Расчёт ещё не загружен');
        expect(wrapper.find('table').exists()).toBe(false);
    });
});
