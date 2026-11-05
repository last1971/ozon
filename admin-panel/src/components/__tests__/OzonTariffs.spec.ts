import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import OzonTariffs from '../OzonTariffs.vue';
import axios from '@/axios.config';

vi.mock('@/axios.config', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const wrapperComponent = { template: '<div><slot /></div>' };
const fileInput = defineComponent({
    emits: ['update:modelValue'],
    setup(_, { emit }) {
        return { select: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).files?.[0]) };
    },
    template: '<input type="file" @change="select" />',
});
const render = async () => {
    const wrapper = mount(OzonTariffs, {
        global: {
            stubs: {
                VRow: wrapperComponent,
                VCol: wrapperComponent,
                VCard: wrapperComponent,
                VAlert: { props: ['type'], template: '<div :data-alert="type"><slot /></div>' },
                VFileInput: fileInput,
                VBtn: { template: '<button><slot /></button>' },
            },
        },
    });
    await flushPromises();
    const input = wrapper.findAll('input')[0];
    Object.defineProperty(input.element, 'files', { value: [new File(['xlsx'], 'commissions.xlsx')] });
    await input.trigger('change');
    await wrapper.findAll('button')[0].trigger('click');
    await flushPromises();
    return wrapper;
};
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(axios.get).mockResolvedValue({ data: [] });
});

describe('Результат импорта комиссий', () => {
    it('показывает успех и предупреждение о пропусках вне каталога', async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: {
                updated: 100,
                rows: 101,
                missingTypes: [{ id: 2, name: 'Блинница электрическая' }],
                retiredTypes: [],
            },
        });
        const wrapper = await render();
        expect(wrapper.find('[data-alert=success]').text()).toContain('Комиссии сохранены: 100');
        expect(wrapper.find('[data-alert=warning]').text()).toContain('Таких товаров в вашем кабинете нет');
        expect(wrapper.find('[data-alert=warning]').text()).toContain('2 — Блинница электрическая');
        expect(wrapper.find('[data-alert=error]').exists()).toBe(false);
    });
    it('показывает ошибку по своему товару, не сообщает об успешной загрузке', async () => {
        vi.mocked(axios.post).mockRejectedValue({
            isAxiosError: true,
            response: {
                data: {
                    message: 'Нет комиссии для товара Блинница. Прежние тарифы сохранены.',
                },
            },
        });
        const wrapper = await render();
        expect(wrapper.find('[data-alert=error]').text()).toContain('Нет комиссии для товара Блинница');
        expect(wrapper.find('[data-alert=success]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Файл загружен');
    });
    it('разделяет отсутствующие комиссии и отключённые типы', async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: {
                updated: 100,
                rows: 101,
                missingTypes: [{ id: 2, name: 'Нет тарифа' }],
                retiredTypes: [{ id: 3, name: 'Отключённый' }],
            },
        });
        const wrapper = await render();
        const warnings = wrapper.findAll('[data-alert=warning]');
        expect(warnings).toHaveLength(2);
        expect(warnings[0].text()).toContain('2 — Нет тарифа');
        expect(warnings[1].text()).toContain('3 — Отключённый');
    });
    it('полный файл не показывает предупреждений о пропусках', async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: { updated: 100, rows: 100, missingTypes: [], retiredTypes: [] },
        });
        const wrapper = await render();
        expect(wrapper.find('[data-alert=success]').exists()).toBe(true);
        expect(wrapper.find('[data-alert=warning]').exists()).toBe(false);
    });
});
