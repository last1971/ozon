import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import MarketplaceLoss from '../MarketplaceLoss.vue';
import JobProgress from '../JobProgress.vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
vi.mock('@/axios.config', () => ({ default: { get: vi.fn(), post: vi.fn() }, clientId: () => 'browser-1' }));
const markets = [
    { service: 'OZON', label: 'Ozon' },
    { service: 'WB', label: 'ВБ' },
    { service: 'YANDEX', label: 'Яндекс' },
];
const kinds = markets.map((m) => `loss-recalculate:${m.service.toLowerCase()}`);
const date = '2026-11-07T07:00:00Z';
const row = (offerId = '123-5') => ({
    offerId,
    soldUnits: 3,
    returnedUnits: 3,
    writtenOffUnits: 0,
    returnRate: 1,
    appliedReturnRate: 1,
    defectRate: 0,
    state: 'READY',
    warnings: [],
    calculatedAt: date,
    expenses: { cancellationDelivery: 0, sellerReturnDelivery: null, confirmedDefectCompensation: 0 },
});
const snapshot = (service = 'OZON', rows: unknown[] = [row()]) => ({
    service,
    preliminary: false,
    period: { from: '2026-08-09', to: '2026-11-07' },
    calculatedAt: date,
    rows,
});
const state = (status = 'running', service = 'OZON') => ({
    id: `job-${service}`,
    kind: `loss-recalculate:${service.toLowerCase()}`,
    params: {},
    status,
    progress: { phase: 'Запись статистики', done: 45, total: 100, percent: status === 'done' ? 100 : 80, counters: {} },
    clientId: 'browser-1',
    startedAt: date,
    result: status === 'done' ? { rows: 1 } : undefined,
});
const slot = { template: '<div><slot /></div>' };
const select = defineComponent({
    props: ['modelValue', 'items'],
    emits: ['update:modelValue'],
    template: `<select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)"><option v-for="item in items" :value="item.service">{{ item.label }}</option></select>`,
});
const input = defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
});
let wrappers: ReturnType<typeof mount>[] = [];
const render = async () => {
    const w = mount(MarketplaceLoss, {
        global: {
            stubs: {
                VSelect: select,
                VTextField: input,
                VTable: { template: '<table><slot /></table>' },
                VBtn: { props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
                VCard: slot,
                VAlert: { props: ['type'], template: '<div :data-alert="type"><slot /></div>' },
                VIcon: true,
                VProgressLinear: { props: ['modelValue'], template: '<div data-progress :data-value="modelValue" />' },
                VPagination: true,
            },
        },
    });
    wrappers.push(w);
    await flushPromises();
    return w;
};
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll('button').find((b) => b.text().includes(text))!;
const get = (url: any) => {
    if (url === '/api/marketplace-loss') return { data: markets };
    if (url === '/api/job') return { data: [] };
    if (String(url).startsWith('/api/marketplace-loss/')) return { data: snapshot(String(url).split('/')[3]) };
    return { data: null };
};
beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    localStorage.clear();
    kinds.forEach((kind) => useJob(kind).clear());
    vi.mocked(axios.get).mockImplementation(async (url) => get(url));
});
afterEach(() => {
    wrappers.forEach((w) => w.unmount());
    wrappers = [];
    kinds.forEach((kind) => useJob(kind).clear());
    vi.useRealTimers();
});
describe('Статистика потерь по площадкам', () => {
    it('показывает 3/3=100%, нулевой брак, исходные количества, период, дату и неизвестные суммы', async () => {
        const w = await render();
        const cells = w.findAll('tbody td').map((c) => c.text());
        expect(cells.slice(0, 4)).toEqual(['123-5', '3', '3', '0']);
        expect(cells[4]).toContain('100%');
        expect(cells[5]).toBe('0%');
        expect(w.text()).toContain('2026-08-09 — 2026-11-07 (не включая)');
        expect(w.text()).toContain('07.11.2026');
        expect(w.text()).toContain('Есть неизвестные расходы');
        expect(w.text()).toContain('Возврат продавцу: нет данных');
        expect(w.text()).toContain('по тарифу Ozon');
        expect(axios.post).not.toHaveBeenCalled();
    });
    it('отличает отсутствие снимка от нулевых потерь', async () => {
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data: url === '/api/marketplace-loss/OZON' ? null : get(url).data,
        }));
        const w = await render();
        expect(w.text()).toContain('Статистика ещё не рассчитана');
        expect(w.find('table').exists()).toBe(false);
    });
    it('без продаж/неизвестные возвраты — нет данных; значения выше 100% не обрезаются', async () => {
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data:
                url === '/api/marketplace-loss/OZON'
                    ? snapshot('OZON', [
                          {
                              ...row('123'),
                              soldUnits: 0,
                              returnedUnits: null,
                              returnRate: null,
                              appliedReturnRate: 0.05,
                              defectRate: null,
                              state: 'NO_SALES',
                          },
                          { ...row('124'), returnRate: 1.5, warnings: ['Возвратов больше продаж'] },
                      ])
                    : get(url).data,
        }));
        const w = await render();
        const rows = w.findAll('tbody tr');
        expect(rows[0].text()).toContain('нет данных');
        expect(rows[0].text()).toContain('В цене: 5%');
        expect(rows[0].text()).toContain('Нет продаж');
        expect(rows[1].text()).toContain('150%');
        expect(rows[1].text()).toContain('Возвратов больше продаж');
    });
    it('меняет площадку и показывает PARTIAL Яндекса без чужого процента Ozon', async () => {
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data:
                url === '/api/marketplace-loss/YANDEX'
                    ? {
                          ...snapshot('YANDEX', [
                              {
                                  ...row('999'),
                                  returnedUnits: null,
                                  returnRate: null,
                                  appliedReturnRate: null,
                                  state: 'PARTIAL',
                                  expenses: undefined,
                              },
                          ]),
                          preliminary: true,
                      }
                    : get(url).data,
        }));
        const w = await render();
        await w.find('select').setValue('YANDEX');
        await flushPromises();
        expect(w.text()).toContain('999');
        expect(w.text()).toContain('Неполные данные');
        expect(w.text()).toContain('Данные предварительные');
        expect(w.text()).not.toContain('В цене:');
        expect(axios.get).toHaveBeenCalledWith('/api/marketplace-loss/YANDEX');
    });
    it('ручной запуск показывает общий прогресс, фазу и N из M; блокирует повтор и обновляет снимок после done', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: state() });
        const w = await render();
        await button(w, 'Пересчитать статистику').trigger('click');
        await flushPromises();
        expect(axios.post).toHaveBeenCalledWith('/api/marketplace-loss/OZON/recalculate');
        expect(w.findComponent(JobProgress).exists()).toBe(true);
        expect(w.text()).toContain('80%');
        expect(w.text()).toContain('Запись статистики: 45 из 100');
        expect(button(w, 'Пересчитать статистику').attributes('disabled')).toBeDefined();
        const before = vi.mocked(axios.get).mock.calls.filter(([url]) => url === '/api/marketplace-loss/OZON').length;
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data: url === '/api/job' ? [state('done')] : url === '/api/job/job-OZON' ? state('done') : get(url).data,
        }));
        await vi.advanceTimersByTimeAsync(2000);
        await flushPromises();
        expect(w.text()).toContain('Статистика сохранена');
        expect(w.text()).toContain('100%');
        expect(vi.mocked(axios.get).mock.calls.filter(([url]) => url === '/api/marketplace-loss/OZON')).toHaveLength(
            before + 1,
        );
        await vi.advanceTimersByTimeAsync(60000);
        await flushPromises();
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(vi.mocked(axios.get).mock.calls.filter(([url]) => url === '/api/marketplace-loss/OZON')).toHaveLength(
            before + 1,
        );
    });
    it('подхватывает текущую задачу после перезагрузки, не запускает пересчёт снова', async () => {
        localStorage.setItem('job:loss-recalculate:ozon', 'job-OZON');
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data: url === '/api/job' ? [state()] : url === '/api/job/job-OZON' ? state() : get(url).data,
        }));
        const w = await render();
        expect(w.text()).toContain('80%');
        expect(axios.post).not.toHaveBeenCalled();
    });
    it('ошибка задачи сохраняет прежние сведения и не сообщает об успешной записи', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { ...state('failed'), error: 'API недоступен' } });
        const w = await render();
        await button(w, 'Пересчитать статистику').trigger('click');
        await flushPromises();
        expect(w.text()).toContain('API недоступен');
        expect(w.text()).toContain('последний сохранённый снимок');
        expect(w.findAll('tbody tr')).toHaveLength(1);
        expect(w.text()).not.toContain('Статистика сохранена');
    });
    it('ошибки чтения и запуска видны', async () => {
        vi.mocked(axios.post).mockRejectedValue({ response: { data: { message: 'Не удалось начать пересчёт' } } });
        const w = await render();
        await button(w, 'Пересчитать статистику').trigger('click');
        await flushPromises();
        expect(w.text()).toContain('Не удалось начать пересчёт');
        vi.mocked(axios.get).mockRejectedValue(new Error('offline'));
        await button(w, 'Обновить сведения').trigger('click');
        await flushPromises();
        expect(w.text()).toContain('Не удалось прочитать статистику');
        expect(w.findAll('tbody tr')).toHaveLength(1);
    });
    it('показывает рублёвые расходы на продажу, ошибку расчёта не превращает в 0 ₽', async () => {
        const w = await render();
        vi.mocked(axios.get).mockResolvedValueOnce({
            data: {
                offerId: '123-5',
                calculatedAt: date,
                price: 260,
                scheme: 'fbs',
                costs: { returns: 12.5, cancellations: 0, sellerReturns: 1, defects: 2, defectCompensation: 0.5 },
            },
        });
        await button(w, 'На одну продажу').trigger('click');
        await flushPromises();
        expect(w.find('[data-loss-costs]').text()).toContain('Оплаченные возвраты покупателя: 12,5 ₽');
        expect(w.find('[data-loss-costs]').text()).toContain('Чистый резерв брака: 2 ₽');
        vi.mocked(axios.get).mockResolvedValueOnce({ data: { offerId: '123-5', costs: null, error: 'Нет тарифа' } });
        await button(w, 'На одну продажу').trigger('click');
        await flushPromises();
        expect(w.find('[data-loss-costs]').text()).toContain('Нет тарифа');
        expect(w.find('[data-loss-costs]').text()).not.toContain('0 ₽');
    });
    it('опоздавший ответ Ozon не заменяет сведения выбранной ВБ', async () => {
        const w = await render();
        let resolve: (value: any) => void;
        vi.mocked(axios.get).mockImplementationOnce(
            () =>
                new Promise((r) => {
                    resolve = r;
                }),
        );
        await button(w, 'Обновить сведения').trigger('click');
        await w.find('select').setValue('WB');
        await flushPromises();
        resolve!({ data: snapshot('OZON', [row('OLD')]) });
        await flushPromises();
        expect(w.find('select').element.value).toBe('WB');
        expect(w.text()).not.toContain('OLD');
    });
    it('поиск сбрасывает страницу, пустой поиск не инициирует расчёт', async () => {
        const w = await render();
        await w.find('input').setValue('no-such-offer');
        expect(w.findAll('tbody tr')).toHaveLength(0);
        expect(w.text()).toContain('Товаров в снимке по этому поиску нет');
        await w.find('input').setValue('123');
        expect(w.findAll('tbody tr')).toHaveLength(1);
        expect(axios.post).not.toHaveBeenCalled();
    });
});
