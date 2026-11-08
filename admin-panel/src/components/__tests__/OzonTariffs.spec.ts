import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import OzonTariffs from '../OzonTariffs.vue';
import JobProgress from '../JobProgress.vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';

vi.mock('@/axios.config', () => ({ default: { get: vi.fn(), post: vi.fn() }, clientId: () => 'browser-1' }));
const kinds = ['ozon-tariffs-commissions', 'ozon-tariffs-logistics'];
const wrapperComponent = { template: '<div><slot /></div>' };
const fileInput = defineComponent({
    emits: ['update:modelValue'],
    setup(_, { emit }) {
        return { select: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).files?.[0]) };
    },
    template: '<input type="file" @change="select" />',
});
const state = (result?: unknown) => ({
    id: 'job-1',
    kind: kinds[0],
    params: {},
    clientId: 'browser-1',
    status: result ? 'done' : 'running',
    progress: { phase: 'разбор строк', done: 450, total: 1000, percent: 36, counters: {} },
    result,
    startedAt: '2026-11-05T10:00:00Z',
    finishedAt: result ? '2026-11-05T10:00:05Z' : undefined,
});
const render = async (upload = true) => {
    const wrapper = mount(OzonTariffs, {
        global: {
            stubs: {
                VRow: wrapperComponent,
                VCol: wrapperComponent,
                VCard: wrapperComponent,
                VIcon: true,
                VAlert: { props: ['type'], template: '<div :data-alert="type"><slot /></div>' },
                VFileInput: fileInput,
                VBtn: { template: '<button><slot /></button>' },
                VProgressLinear: {
                    props: ['modelValue', 'indeterminate'],
                    template: '<div data-progress :data-value="modelValue" />',
                },
            },
        },
    });
    await flushPromises();
    if (upload) {
        const input = wrapper.findAll('input')[0];
        Object.defineProperty(input.element, 'files', { value: [new File(['xlsx'], 'commissions.xlsx')] });
        await input.trigger('change');
        await wrapper.findAll('button')[0].trigger('click');
        await flushPromises();
    }
    return wrapper;
};
beforeEach(() => {
    vi.resetAllMocks();
    kinds.forEach((kind) => useJob(kind).clear());
    localStorage.clear();
    vi.mocked(axios.get).mockResolvedValue({ data: [] });
});
afterEach(() => kinds.forEach((kind) => useJob(kind).clear()));

describe('Импорт тарифов через существующий useJob', () => {
    it('показывает дату API в Москве, сохраняя календарную дату файла', async () => {
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data:
                url === '/api/ozon-category/tariffs'
                    ? [
                          {
                              kind: 'commissions',
                              filename: 'commissions.xlsx',
                              fileDate: '2026-11-07',
                              uploadedAt: '2026-11-08T02:38:00.007Z',
                              rows: 100,
                              matchedCount: 100,
                              retiredCount: 0,
                              stale: false,
                          },
                      ]
                    : [],
        }));
        const wrapper = await render(false);
        expect(wrapper.text()).toContain('08.11.2026 05:38:00 МСК');
        expect(wrapper.text()).toContain('2026-11-07');
        expect(wrapper.text()).not.toContain('09:38');
        wrapper.unmount();
    });

    it('показывает результат и предупреждение после завершения job', async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: state({
                updated: 100,
                rows: 101,
                missingTypes: [{ id: 2, name: 'Блинница электрическая' }],
                retiredTypes: [],
            }),
        });
        const wrapper = await render();
        expect(wrapper.find('[data-alert=success]').text()).toContain('Комиссии сохранены: 100');
        expect(wrapper.find('[data-alert=warning]').text()).toContain('Таких товаров в вашем кабинете нет');
        expect(wrapper.find('[data-alert=warning]').text()).toContain('2 — Блинница электрическая');
        expect(wrapper.find('[data-alert=error]').exists()).toBe(false);
    });
    it('ошибка запуска показывает ошибку, не успех', async () => {
        vi.mocked(axios.post).mockRejectedValue({
            response: { data: { message: 'Нет комиссии для товара Блинница. Прежние тарифы сохранены.' } },
        });
        const wrapper = await render();
        expect(wrapper.find('[data-alert=error]').text()).toContain('Нет комиссии для товара Блинница');
        expect(wrapper.find('[data-alert=success]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Файл загружен');
    });
    it('разделяет отсутствующие комиссии и отключённые типы', async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: state({
                updated: 100,
                rows: 101,
                missingTypes: [{ id: 2, name: 'Нет тарифа' }],
                retiredTypes: [{ id: 3, name: 'Отключённый' }],
            }),
        });
        const wrapper = await render(),
            warnings = wrapper.findAll('[data-alert=warning]');
        expect(warnings).toHaveLength(2);
        expect(warnings[0].text()).toContain('2 — Нет тарифа');
        expect(warnings[1].text()).toContain('3 — Отключённый');
    });
    it('полный файл не показывает предупреждений', async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: state({ updated: 100, rows: 100, missingTypes: [], retiredTypes: [] }),
        });
        const wrapper = await render();
        expect(wrapper.find('[data-alert=success]').exists()).toBe(true);
        expect(wrapper.find('[data-alert=warning]').exists()).toBe(false);
    });
    it('возвращённый id показывает общий процент, фазу и N из M; успех появляется только после done', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: state() });
        const wrapper = await render();
        expect(wrapper.findComponent(JobProgress).exists()).toBe(true);
        expect(wrapper.text()).toContain('36%');
        expect(wrapper.text()).toContain('разбор строк: 450 из 1000');
        expect(wrapper.find('[data-progress]').attributes('data-value')).toBe('36');
        expect(wrapper.find('[data-alert=success]').exists()).toBe(false);
        const done = { ...state({ updated: 100, rows: 100 }), progress: { ...state().progress, percent: 100 } };
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data: url === '/api/job/job-1' ? done : url === '/api/job' ? [done] : [],
        }));
        await useJob(kinds[0]).refresh();
        await flushPromises();
        expect(wrapper.find('[data-alert=success]').exists()).toBe(true);
        expect(wrapper.text()).toContain('100%');
    });
    it('подхватывает задачу после F5 через useJob, не отправляет файл повторно', async () => {
        localStorage.setItem('job:' + kinds[0], 'job-1');
        vi.mocked(axios.get).mockImplementation(async (url, config) => ({
            data:
                url === '/api/job/job-1'
                    ? state()
                    : url === '/api/job' && config?.params.kind === kinds[0]
                      ? [state()]
                      : [],
        }));
        const wrapper = await render(false);
        expect(wrapper.text()).toContain('36%');
        expect(axios.post).not.toHaveBeenCalled();
    });
    it('failed в ходе фоновой работы показывает ошибку и не сообщает об успешном импорте', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: state() });
        const wrapper = await render();
        const failed = { ...state(), status: 'failed', error: 'Ошибка записи. Прежние тарифы сохранены.' };
        vi.mocked(axios.get).mockImplementation(async (url) => ({
            data: url === '/api/job/job-1' ? failed : url === '/api/job' ? [failed] : [],
        }));
        await useJob(kinds[0]).refresh();
        await flushPromises();
        expect(wrapper.find('[data-alert=error]').text()).toContain('Ошибка записи');
        expect(wrapper.find('[data-alert=success]').exists()).toBe(false);
    });
});
