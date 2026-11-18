import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import OzonPromoSweep from '../OzonPromoSweep.vue';
const state = vi.hoisted(() => ({ job: null as any, error: '' }));
vi.mock('@/axios.config', () => ({ default: {}, clientId: () => 'browser' }));
vi.mock('@/composable/useJob', () => ({ useJob: () => ({ box: reactive(state), attach: vi.fn() }) }));
describe('Итог проверки всех товаров Ozon', () => {
    it('не окрашивает частичный отказ в общий успех и называет весь проверенный каталог', async () => {
        state.job = {
            id: 'sweep',
            status: 'done',
            params: { apply: true, goal: 'min' },
            progress: { percent: 100, done: 1, total: 1, counters: {} },
            result: {
                apply: true,
                goal: 'min',
                checked: 100,
                selected: 2,
                keptInOzon: 1,
                removedFromOzon: 0,
                percentChanged: 1,
                unfixable: 0,
                closest: 0,
                nothingToDo: 0,
                failed: 1,
                items: [],
            },
        };
        const w = mount(OzonPromoSweep, {
            global: {
                stubs: {
                    VCard: { props: ['color'], template: '<div :data-color="color"><slot /></div>' },
                    VCardText: { template: '<div><slot /></div>' },
                    VDataTable: { props: ['items'], template: '<div><template v-for="item in items"><slot name="item.buyerAfter" :item="item"/><slot name="item.steps" :item="item"/></template></div>' },
                },
            },
        });
        expect(w.text()).toContain('100%');
        expect(w.text()).toContain('проверено товаров: 100');
        expect(w.text()).toContain('не всё прошло: 1');
        expect(w.find('[data-color]').attributes('data-color')).toBe('warning');
        reactive(state).job.result.failed = 0;
        reactive(state).job.result.pendingConfirmation = 2;
        await w.vm.$nextTick();
        expect(w.text()).toContain('ожидают подтверждения: 2');
        expect(w.find('[data-color]').attributes('data-color')).toBe('warning');
        reactive(state).job.result.items = [{
            offerId: '539124-5', productId: 1, applied: false, ok: true, buyerAfter: 304, steps: [],
            notes: ['Следующий переход пересекает порог тарифа'],
        }];
        await w.vm.$nextTick();
        expect(w.text()).toContain('Не применено');
        expect(w.text()).toContain('Следующий переход пересекает порог тарифа');
        expect(w.text()).not.toContain('304 ₽');
        w.unmount();
    });
});
