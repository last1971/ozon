import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import OzonPromoSweep from '../OzonPromoSweep.vue';
const state = vi.hoisted(() => ({ job: null as any, error: '' }));
vi.mock('@/axios.config', () => ({ default: {}, clientId: () => 'browser' }));
vi.mock('@/composable/useJob', () => ({ useJob: () => ({ box: reactive(state), attach: vi.fn() }) }));
describe('Итог проверки всех товаров Ozon', () => {
    it('не окрашивает частичный отказ в общий успех и называет весь проверенный каталог', () => {
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
                    VDataTable: true,
                },
            },
        });
        expect(w.text()).toContain('100%');
        expect(w.text()).toContain('проверено товаров: 100');
        expect(w.text()).toContain('не всё прошло: 1');
        expect(w.find('[data-color]').attributes('data-color')).toBe('warning');
        w.unmount();
    });
});
