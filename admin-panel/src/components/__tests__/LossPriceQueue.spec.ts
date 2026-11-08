import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LossPriceQueue from '../LossPriceQueue.vue';
import JobProgress from '../JobProgress.vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
vi.mock('@/axios.config', () => ({ default: { get: vi.fn(), post: vi.fn() }, clientId: () => 'browser' }));
const kind = 'loss-price-update:wb';
const state = (status = 'running') => ({
    id: 'price-job',
    kind,
    clientId: 'browser',
    params: {},
    status,
    progress: { phase: 'Проверка акций', percent: status === 'done' ? 100 : 70, done: 2, total: 3, counters: {} },
    startedAt: '2026-11-07T10:00:00Z',
    result:
        status === 'done'
            ? { processed: 3, completed: 2, sent: 2, pending: [{ offerId: '123', error: 'Нет тарифа' }] }
            : undefined,
});
const queued = [{ extId: '1:123', payload: { offerId: '123', attempts: 2, lastError: 'Нет тарифа' } }];
let wrappers: ReturnType<typeof mount>[] = [];
const render = async (service = 'WB') => {
    const w = mount(LossPriceQueue, {
        props: { service },
        global: {
            stubs: {
                VBtn: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
                VAlert: { props: ['type'], template: '<div :data-alert="type"><slot /></div>' },
                VIcon: true,
                VProgressLinear: { props: ['modelValue'], template: '<div data-progress :data-value="modelValue" />' },
            },
        },
    });
    wrappers.push(w);
    await flushPromises();
    return w;
};
beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    localStorage.clear();
    ['wb', 'ozon'].forEach((s) => useJob(`loss-price-update:${s}`).clear());
    vi.mocked(axios.get).mockResolvedValue({ data: [] });
});
afterEach(() => {
    wrappers.forEach((w) => w.unmount());
    wrappers = [];
    ['wb', 'ozon'].forEach((s) => useJob(`loss-price-update:${s}`).clear());
    vi.useRealTimers();
});
it('чтение показывает незавершённые задания и причину, не запускает POST', async () => {
    vi.mocked(axios.get).mockImplementation(async (url) => ({ data: url === '/api/job' ? [] : queued }));
    const w = await render();
    expect(w.text()).toContain('Незавершённых заданий: 1');
    expect(w.text()).toContain('123: Нет тарифа; попыток 2');
    expect(axios.post).not.toHaveBeenCalled();
});
it('ручной повтор использует общий прогресс; 100% прохода не означает отсутствие ошибок', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: state() });
    const w = await render();
    await w.findAll('button')[0].trigger('click');
    await flushPromises();
    expect(axios.post).toHaveBeenCalledWith('/api/marketplace-loss/WB/prices');
    expect(w.findComponent(JobProgress).exists()).toBe(true);
    expect(w.text()).toContain('70%');
    expect(w.text()).toContain('Проверка акций: 2 из 3');
    expect(w.findAll('button')[0].attributes('disabled')).toBeDefined();
    vi.mocked(axios.get).mockImplementation(async (url) => ({
        data: url === '/api/job' ? [state('done')] : url === '/api/job/price-job' ? state('done') : queued,
    }));
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(w.text()).toContain('100%');
    expect(w.text()).toContain('завершено 2');
    expect(w.text()).toContain('Незавершённых заданий: 1');
    expect(w.text()).toContain('Нет тарифа');
    const requests = vi.mocked(axios.get).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    await flushPromises();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(requests);
});
it('после F5 подхватывает задачу без новой отправки', async () => {
    localStorage.setItem('job:' + kind, 'price-job');
    vi.mocked(axios.get).mockImplementation(async (url) => ({
        data: url === '/api/job' ? [state()] : url === '/api/job/price-job' ? state() : [],
    }));
    const w = await render();
    expect(w.text()).toContain('70%');
    expect(axios.post).not.toHaveBeenCalled();
});
it('ошибка запроса и failed job видны без сообщения о завершении', async () => {
    vi.mocked(axios.post).mockRejectedValue({ response: { data: { message: 'API недоступен' } } });
    const w = await render();
    await w.findAll('button')[0].trigger('click');
    await flushPromises();
    expect(w.text()).toContain('API недоступен');
    expect(w.text()).not.toContain('Проход очереди завершён');
    vi.mocked(axios.post).mockResolvedValue({ data: { ...state('failed'), error: 'Ошибка очереди' } });
    await w.findAll('button')[0].trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Ошибка очереди');
});
it('Яндекс не предлагает отправку по неполным расходам и не обращается к очереди', async () => {
    const w = await render('YANDEX');
    expect(w.find('[data-loss-price-queue]').exists()).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
});
it('поздний ответ прежней площадки не заменяет новую очередь', async () => {
    const w = await render();
    let release: (value: any) => void;
    vi.mocked(axios.get).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                release = resolve;
            }),
    );
    await w.findAll('button')[1].trigger('click');
    await w.setProps({ service: 'OZON' });
    await flushPromises();
    release!({ data: queued });
    await flushPromises();
    expect(w.text()).not.toContain('Нет тарифа');
});

it('ожидание остатка отдельно от ошибок; число попыток не вводит в заблуждение', async () => {
    vi.mocked(axios.get).mockImplementation(async (url) => ({
        data:
            url === '/api/job'
                ? []
                : [...queued, { extId: '2:456', payload: { offerId: '456', waitingForStock: true, attempts: 3 } }],
    }));
    const w = await render();
    const wait = w.find('[data-waiting-stock]');
    expect(wait.attributes('data-alert')).toBe('info');
    expect(wait.text()).toContain('456: ожидание остатка');
    expect(wait.text()).not.toContain('попыток');
    expect(w.find('[data-alert="warning"]').text()).toContain('Нет тарифа');
    expect(w.find('[data-alert="warning"]').text()).not.toContain('456');
});
it('только пустые товары не вызывают предупреждение об ошибках', async () => {
    vi.mocked(axios.get).mockImplementation(async (url) => ({
        data: url === '/api/job' ? [] : [{ extId: '1:123', payload: { offerId: '123', waitingForStock: true } }],
    }));
    const w = await render();
    expect(w.find('[data-alert="warning"]').exists()).toBe(false);
    expect(w.text()).toContain('Ожидают остатка: 1');
});
