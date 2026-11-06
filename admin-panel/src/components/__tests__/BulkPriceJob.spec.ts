import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import BulkPriceJob from '../BulkPriceJob.vue';
const state = vi.hoisted(() => ({ job: null as any, error: '' }));
vi.mock('@/composable/useJob', () => ({ useJob: () => ({ box: reactive(state), attach: vi.fn() }) }));
describe('Итог массового обновления', () => {
    it('показывает общий прогресс через существующий компонент и отдельные причины отказов', async () => {
        state.job = {
            status: 'running',
            progress: { phase: 'Расчёт и отправка цен', percent: 50, done: 100, total: 200 },
        };
        const wrapper = mount(BulkPriceJob, { props: { market: 'wb' } });
        expect(wrapper.text()).toContain('50%');
        expect(wrapper.text()).toContain('100 из 200');
        reactive(state).job = {
            ...state.job,
            status: 'done',
            result: {
                total: 22,
                accepted: 0,
                unchanged: 20,
                skipped: 1,
                failed: 1,
                rows: [
                    { offer_id: '123', status: 'error', reason: 'Invalid data format' },
                    { offer_id: '456', status: 'skipped', reason: 'no-base' },
                ],
                warnings: [],
            },
        };
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('Уже совпадало: 20');
        expect(wrapper.text()).toContain('Ошибок: 1');
        expect(wrapper.text()).toContain('Invalid data format');
        expect(wrapper.text()).toContain('Нет базы для расчёта');
        expect(wrapper.text()).toContain('Это ещё не подтверждение применения цен');
    });
});
