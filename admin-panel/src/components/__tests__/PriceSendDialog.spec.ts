import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import PriceSendDialog from '../PriceSendDialog.vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
vi.mock('@/axios.config', () => ({ default: { post: vi.fn(), get: vi.fn() }, clientId: () => 'test' }));
let wrapper: VueWrapper;
const kind = 'price-review:123';
const state = (sent = false) => ({
    id: sent ? 'send' : 'prepare',
    kind,
    status: 'done',
    params: {},
    progress: { done: 1, total: 1, percent: 100, counters: {} },
    result: {
        token: sent ? undefined : 'token',
        sent,
        expiresAt: Date.now() + 10000,
        entries: [{ service: 'ozon', prices: [{ offer_id: '123', min_price: '260', price: '569', old_price: '708' }] }],
    },
});
beforeEach(() => {
    vi.resetAllMocks();
    useJob(kind).clear();
    vi.mocked(axios.post).mockImplementation(async (url) => ({ data: state(url.endsWith('/send')) }));
    vi.mocked(axios.get).mockResolvedValue({ data: [] });
    wrapper = mount(PriceSendDialog, {
        props: { offerId: '123', settingsKey: 'initial', disabled: false },
        global: {
            stubs: {
                VBtn: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
                VDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
                VCard: { template: '<div><slot /></div>' },
                VCardText: { template: '<div><slot /></div>' },
                VCardActions: { template: '<div><slot /></div>' },
                VTable: { template: '<table><slot /></table>' },
                VAlert: { template: '<div><slot /></div>' },
                JobProgress: true,
            },
        },
    });
});
afterEach(() => {
    wrapper.unmount();
    useJob(kind).clear();
});
async function prepare() {
    await wrapper.find('button').trigger('click');
    await flushPromises();
}
const confirm = () => wrapper.findAll('button').find((b) => b.text().includes('Подтвердить'))!;
describe('Подтверждение отправки', () => {
    it('до подтверждения только готовит цены, после отправляет только token', async () => {
        await prepare();
        expect(wrapper.text()).toContain('260 ₽');
        expect(wrapper.text()).toContain('569 ₽');
        expect(wrapper.text()).toContain('708 ₽');
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith('/api/price/review', { offerId: '123' });
        await confirm().trigger('click');
        await flushPromises();
        expect(axios.post).toHaveBeenLastCalledWith('/api/price/review/send', { token: 'token' });
        expect(wrapper.emitted('sent')).toHaveLength(1);
    });
    it('правка настроек после подготовки запрещает отправку прежнего снимка', async () => {
        await prepare();
        await wrapper.setProps({ settingsKey: 'changed', disabled: true });
        expect(confirm().attributes('disabled')).toBeDefined();
        await confirm().trigger('click');
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain('Настройки изменились');
    });
});

it('предупреждение о средней категории видно до подтверждения и само не запрещает отправку', async () => {
    const preview = state();
    Object.assign(preview.result.entries[0], { warnings: ['Использована средняя доставка по категории'] });
    vi.mocked(axios.post).mockResolvedValueOnce({ data: preview });
    await prepare();
    expect(wrapper.text()).toContain('Использована средняя доставка по категории');
    expect(confirm().attributes('disabled')).toBeUndefined();
    expect(axios.post).toHaveBeenCalledTimes(1);
});
