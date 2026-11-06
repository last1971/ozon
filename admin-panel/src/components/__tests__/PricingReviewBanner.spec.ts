import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from '@/axios.config';
import PricingReviewBanner from '../PricingReviewBanner.vue';
vi.mock('@/axios.config', () => ({ default: { get: vi.fn() } }));
const render = () => mount(PricingReviewBanner, { global: { stubs: { VAlert: { template: '<div><slot /></div>' } } } });
describe('PricingReviewBanner', () => {
    beforeEach(() => { vi.clearAllMocks(); });
    it('показывает запрет отправки при режиме проверки', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: { reviewMode: true } });
        const wrapper = render();
        await flushPromises();
        expect(wrapper.text()).toContain('Автоматическое и ручное изменение цен и акций отключено');
    });
    it('не показывает предупреждение при обычном режиме', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: { reviewMode: false } });
        const wrapper = render();
        await flushPromises();
        expect(wrapper.text()).toBe('');
    });
    it('не выдаёт ошибку чтения статуса за разрешение записи', async () => {
        vi.mocked(axios.get).mockRejectedValue(new Error('offline'));
        const wrapper = render();
        await flushPromises();
        expect(wrapper.text()).toContain('Статус режима цен не получен');
    });
});
