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
const render = (data?: OzonPricingResultDto, loading = false, editable = false) =>
    mount(OzonPricingResult, {
        props: { result: data, loading },
        slots: editable ? { markup: '<span>Процент</span>' } : {},
        global: {
            stubs: {
                VAlert: { template: '<div><slot /></div>' },
                VTable: { template: '<table><slot /></table>' },
                VRow: { template: '<div><slot /></div>' },
                VCol: { template: '<div><slot /></div>' },
            },
        },
    });
describe('Отдельный блок расчётных цен', () => {
    it('показывает текущие и расчётные цены в отдельных колонках, три уровня и источник базы', () => {
        const wrapper = render(result());
        expect(wrapper.text()).toContain('Текущие и расчётные цены Ozon');
        expect(wrapper.findAll('th').map((th) => th.text())).toEqual([
            'Уровень',
            'Задано',
            'Применено',
            'Текущая Ozon',
            'Расчётная',
            'Прибыль, ₽ / % от базы',
            'Схема',
            'Комиссия',
        ]);
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0].findAll('td').map((td) => td.text())).toEqual([
            'Мин',
            '—%',
            '—%',
            '800 ₽',
            '229 ₽',
            '20,3 ₽ / 20,3%',
            'FBS',
            '20%',
        ]);
        expect(rows[2].text()).toContain('FBO');
        expect(wrapper.text()).toContain('База себестоимости: Остаточные партии — 100 ₽');
        expect(wrapper.text()).toContain('Между 300 ₽ и 650 ₽');
        expect(wrapper.find('details').text()).toContain('Оплаченные возвраты покупателя: 20 ₽');
    });
    it('ошибка скрывает таблицу и устаревшие цены', () => {
        const wrapper = render({ ...result(), error: 'Нет базы себестоимости' });
        expect(wrapper.find('table').exists()).toBe(false);
        expect(wrapper.find('[role=status]').text()).toBe('Нет базы себестоимости');
        expect(wrapper.find('[role=status]').classes()).toContain('text-grey');
        expect(wrapper.find('details').exists()).toBe(false);
    });
    it('при обновлении сохраняет прежнюю таблицу и заменяет её только после ответа', async () => {
        const wrapper = render(result());
        await wrapper.setProps({ loading: true });
        expect(wrapper.find('[role=status]').text()).toBe('Обновление…');
        expect(wrapper.attributes('aria-busy')).toBe('true');
        expect(wrapper.find('table').exists()).toBe(true);
        expect(wrapper.findAll('tbody tr')[0].findAll('td')[4].text()).toBe('229 ₽');
        expect(wrapper.find('details').text()).toContain('Оплаченные возвраты покупателя: 20 ₽');
        await wrapper.setProps({ result: { ...result(), min: { ...result().min!, price: 250 } }, loading: false });
        expect(wrapper.text()).not.toContain('Обновление…');
        expect(wrapper.attributes('aria-busy')).toBe('false');
        expect(wrapper.findAll('tbody tr')[0].findAll('td')[4].text()).toBe('250 ₽');
    });
    it('при первой загрузке без результата показывает «Расчёт…»', () => {
        const wrapper = render(undefined, true);
        expect(wrapper.find('[role=status]').text()).toBe('Расчёт…');
        expect(wrapper.find('table').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Расчёт ещё не загружен');
    });
    it('не выдумывает мёртвую зону и нулевую текущую цену', () => {
        const wrapper = render({ ...result(), deadZoneFloor: undefined, current: null });
        expect(wrapper.text()).not.toContain('Мёртвая зона');
        expect(wrapper.findAll('tbody tr')[0].findAll('td')[3].text()).toBe('—');
    });
    it('показывает заданные 5%, применённые 10%, источник расходов и причину отказа нижней ступени', () => {
        const wrapper = render({
            ...result(),
            min: { ...result().min!, requestedMarkup: 5, appliedMarkup: 10, profitPercent: 10 },
            limits: { minProfitRub: 15, minMarkupPercent: 10 },
            lowerBand: { ceiling: 300, profit: 5.71, targetProfit: 17.16, eligible: false },
            costSources: { firstMile: 'API Ozon', handling: 'Настройка сервера' },
        });
        expect(wrapper.text()).toContain('Минимум сервера: 15 ₽ прибыли и 10%');
        expect(wrapper.findAll('tbody tr')[0].text()).toContain('5%');
        expect(wrapper.findAll('tbody tr')[0].text()).toContain('10%');
        expect(wrapper.text()).toContain('действует минимум сервера');
        expect(wrapper.text()).toContain('При 300 ₽ прибыль 5,71 ₽, требуется 17,16 ₽');
        expect(wrapper.text()).toContain('Ступень до 300 ₽ не обеспечивает');
        expect(wrapper.find('details').text()).toContain('API Ozon');
    });
    it('ошибка расчёта не прячет поля для исправления процента и не показывает NaN', () => {
        const wrapper = mount(OzonPricingResult, {
            props: {
                result: { ...result(), base: 0, min: null, normal: null, max: null, error: 'Некорректная наценка' },
            },
            slots: { markup: '<input aria-label="Процент" />' },
            global: {
                stubs: {
                    VTable: { template: '<table><slot /></table>' },
                    VRow: { template: '<div><slot /></div>' },
                    VCol: { template: '<div><slot /></div>' },
                },
            },
        });
        expect(wrapper.findAll('input')).toHaveLength(3);
        expect(wrapper.text()).toContain('Некорректная наценка');
        expect(wrapper.text()).not.toContain('NaN');
    });
    it('без данных показывает состояние ожидания', () => {
        const wrapper = render();
        expect(wrapper.text()).toContain('Расчёт ещё не загружен');
        expect(wrapper.find('table').exists()).toBe(false);
    });
});

it('при ошибке тарифа форма товара сохраняет известную базу и текущие цены', () => {
    const wrapper = render(
        {
            ...result(),
            min: null,
            normal: null,
            max: null,
            costs: null,
            error: 'Нет импортированных комиссий Ozon',
        },
        false,
        true,
    );
    expect(wrapper.text()).toContain('Нет импортированных комиссий Ozon');
    expect(wrapper.text()).toContain('База себестоимости: Остаточные партии — 100 ₽');
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('800 ₽');
    expect(wrapper.text()).not.toContain('Нет базы');
});

it('показывает предупреждение о средней доставке категории рядом с расчётом', () => {
    const data = { ...result(), warnings: ['Использована средняя доставка по категории'] };
    const wrapper = render(data);
    expect(wrapper.text()).toContain('Использована средняя доставка по категории');
    expect(wrapper.find('table').exists()).toBe(true);
});

it('показывает процент и закупочную базу брака, чистый резерв и уже учтённое возмещение', () => {
    const data = {
        ...result(),
        base: 400,
        defectBasis: { rate: 0.08, purchaseCost: 100 },
        costs: { ...result().costs!, defects: 7, defectCompensation: 1 },
    };
    const w = render(data);
    expect(w.find('[data-defect-basis]').text()).toContain('8% от закупочной стоимости упаковки 100 ₽');
    expect(w.find('[data-defect-basis]').text()).toContain('чистый резерв 7 ₽');
    expect(w.find('details').text()).toContain('повторно не вычитается');
    expect(w.find('details').text()).toContain('Оплаченные возвраты покупателя: 20 ₽');
    expect(w.find('details').text()).toContain('Чистый резерв брака: 7 ₽');
    expect(w.find('details').text()).toContain('Уже учтённое возмещение брака: 1 ₽');
});
