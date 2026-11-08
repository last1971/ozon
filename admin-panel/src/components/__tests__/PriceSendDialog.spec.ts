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
function renderDialog() {
    return mount(PriceSendDialog, {
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
}
beforeEach(() => {
    vi.resetAllMocks();
    useJob(kind).clear();
    vi.mocked(axios.post).mockImplementation(async (url) => ({ data: state(url.endsWith('/send')) }));
    vi.mocked(axios.get).mockResolvedValue({ data: [] });
    wrapper = renderDialog();
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

it('во время отправки сохраняет рассчитанные суммы, а после 100% отдельно показывает ошибки и пропуски', async () => {
    await prepare();
    vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
            ...state(),
            id: 'sending',
            status: 'running',
            result: undefined,
            params: { mode: 'send' },
            progress: {
                done: 0,
                total: 3,
                percent: 0,
                counters: {},
                activities: { ozon: { state: 'waiting', phase: 'Ожидание текущей операции Ozon' } },
            },
        },
    });
    await confirm().trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('260 ₽');
    expect(wrapper.text()).toContain('Обновление ещё не завершено');
    expect(wrapper.text()).not.toContain('Запрос принят площадкой');
    const done = {
        ...state(true),
        result: {
            sent: true,
            entries: [
                { ...state().result.entries[0], status: 'accepted' },
                { service: 'wb', prices: [], status: 'failed', error: 'ВБ не подтвердил цену' },
                { service: 'avito', prices: [], status: 'skipped', error: 'Нет карточки' },
            ],
        },
    };
    vi.mocked(axios.get).mockImplementation(async (url) => ({ data: url === '/api/job' ? [done] : done }));
    await useJob(kind).refresh();
    await flushPromises();
    expect(wrapper.text()).toContain('100% — задача завершена');
    expect(wrapper.text()).toContain('не означает, что все площадки приняли цены');
    expect(wrapper.text()).toContain('Запрос принят площадкой');
    expect(wrapper.text()).toContain('Ошибка: обновление не подтверждено');
    expect(wrapper.text()).toContain('Не отправлено');
    expect(wrapper.text()).toContain('ВБ не подтвердил цену');
});
it('после перезагрузки подхватывает ожидающую отправку без нового POST', async () => {
    wrapper.unmount();
    useJob(kind).clear();
    localStorage.setItem(`job:${kind}`, 'restored');
    const restored: any = {
        ...state(),
        id: 'restored',
        status: 'running',
        result: undefined,
        params: { mode: 'send' },
        progress: {
            percent: 0,
            done: 0,
            total: 2,
            counters: {},
            activities: {
                ozon: {
                    state: 'waiting',
                    phase: 'Ожидание текущей операции Ozon',
                    waitingFor: { id: 'sweep', kind: 'ozon-promo-sweep', percent: 64 },
                },
            },
        },
    };
    vi.mocked(axios.get).mockImplementation(async (url) => ({ data: url === '/api/job' ? [restored] : restored }));
    wrapper = renderDialog();
    await flushPromises();
    expect(wrapper.text()).toContain('Товар 123');
    expect(wrapper.text()).not.toContain('Настройки изменились');
    expect(useJob(kind).box.job?.progress.activities?.ozon.waitingFor?.percent).toBe(64);
    expect(axios.post).not.toHaveBeenCalled();
});
