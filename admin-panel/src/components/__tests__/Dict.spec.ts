import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import axios from '@/axios.config';
import { useJob } from '@/composable/useJob';
import { DICT_CATEGORIES_JOB, DICT_TNVED_JOB } from '@/stores/dict';
import type { JobState } from '@/contracts/job.state';
import Dict from '../Dict.vue';

vi.mock('@/axios.config', () => ({ default: { get: vi.fn(), post: vi.fn() }, clientId: () => 'browser-1' }));
const kinds = [DICT_CATEGORIES_JOB, DICT_TNVED_JOB];
let wrapper: VueWrapper | undefined;
beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    setActivePinia(createPinia());
    kinds.forEach((kind) => useJob(kind).clear());
    localStorage.clear();
});
afterEach(() => {
    wrapper?.unmount();
    kinds.forEach((kind) => useJob(kind).clear());
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('Обновление статистики справочника', () => {
    it.each(kinds)('%s: опрос с прежним статусом не перезагружает статистику', async (kind) => {
        let status: JobState['status'] = 'running';
        const job = (): JobState => ({
            id: 'job-1', kind, status, params: {}, clientId: 'browser-1',
            progress: { done: 1, total: 10, counters: {} }, startedAt: new Date().toISOString(),
        });
        vi.mocked(axios.get).mockImplementation(async (url) => {
            if (url === '/api/job/job-1') return { data: job() };
            if (url === '/api/job' || url === '/api/dict/stats') return { data: [] };
            throw new Error(`Неожиданный GET ${url}`);
        });
        wrapper = shallowMount(Dict, {
            global: {
                stubs: ['VAlert', 'VBtn', 'VCard', 'VCardText', 'VCardTitle', 'VCheckbox', 'VChip',
                    'VCol', 'VContainer', 'VDataTable', 'VIcon', 'VRow', 'VTextField'],
            },
        });
        await flushPromises();
        await useJob(kind).start(async () => job());
        await nextTick();
        await flushPromises();
        vi.mocked(axios.get).mockClear();
        await vi.advanceTimersByTimeAsync(60_000);
        const requests = (url: string) => vi.mocked(axios.get).mock.calls.filter(([path]) => path === url);
        expect(requests('/api/job/job-1')).toHaveLength(30);
        expect(requests('/api/dict/stats')).toHaveLength(0);
        status = 'done';
        await vi.advanceTimersByTimeAsync(2000);
        expect(requests('/api/dict/stats')).toHaveLength(1);
    });
});
