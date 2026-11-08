import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import JobProgress from '../JobProgress.vue';
import type { JobState } from '@/contracts/job.state';

const job = (): JobState => ({
    id: '1',
    kind: 'legacy',
    params: {},
    startedAt: '',
    status: 'running',
    progress: { phase: 'сверка', done: 3, total: 10, counters: { ok: 2 } },
});
const render = (state = job(), extra = {}) =>
    mount(JobProgress, {
        props: { job: state, ...extra },
        slots: { title: 'Проверка' },
        global: {
            stubs: {
                VIcon: { props: ['icon'], template: '<i :data-icon="icon" />' },
                VProgressLinear: {
                    props: ['modelValue', 'indeterminate', 'height'],
                    template:
                        '<div data-bar :data-value="modelValue" :data-indeterminate="indeterminate" :data-height="height" />',
                },
            },
        },
    });
describe('Общий блок прогресса', () => {
    it('старые задачи показывают прежний процент фазы, текст и счётчики', () => {
        const w = render(job(), { showCounters: true });
        expect(w.text()).toContain('сверка: 3 из 10');
        expect(w.find('[data-bar]').attributes('data-value')).toBe('30');
        expect(w.text()).not.toContain('%');
        expect(w.text()).toContain('ok: 2');
    });
    it('общий процент имеет приоритет над процентом фазы', () => {
        const j = job();
        j.progress.percent = 65;
        const w = render(j);
        expect(w.text()).toContain('65%');
        expect(w.find('[data-bar]').attributes('data-value')).toBe('65');
    });
    it('неизвестный размер фазы сохраняет индикатор без процента', () => {
        const j = job();
        delete j.progress.total;
        const w = render(j);
        expect(w.text()).toContain('сверка: 3');
        expect(w.find('[data-bar]').attributes('data-indeterminate')).toBe('true');
        expect(render(j, { showCountWithoutTotal: false }).text()).not.toContain('сверка: 3');
    });
    it('режим прежней проверки пустых карточек сохраняет высоту, текст и индикатор', () => {
        const w = render(job(), { compact: true, indeterminate: true, doneIcon: 'mdi-database-search' });
        expect(w.text()).toContain('сверка 3 из 10');
        expect(w.find('[data-bar]').attributes('data-height')).toBe('6');
        expect(w.find('[data-bar]').attributes('data-indeterminate')).toBe('true');
    });
    it('завершение и ошибка показывают прежние сообщения, без полосы', () => {
        const j = job();
        j.status = 'done';
        expect(render(j, { doneText: 'готово: 10' }).text()).toContain('готово: 10');
        expect(render(j).find('[data-bar]').exists()).toBe(false);
        j.status = 'failed';
        j.error = 'ошибка API';
        expect(render(j).text()).toContain('ошибка: ошибка API');
        expect(render(j).find('i').attributes('data-icon')).toBe('mdi-alert-circle');
        expect(render(j, { inline: true, doneText: 'failed' }).text()).toBe('failed');
    });
});

it('ожидание показывает процент фона отдельно от процента отправки', () => {
    const j = job();
    Object.assign(j.progress, {
        percent: 0,
        activities: {
            ozon: {
                state: 'waiting',
                phase: 'Ожидание текущей операции Ozon',
                waitingFor: {
                    id: 'sweep',
                    kind: 'ozon-promo-sweep',
                    percent: 64,
                    phase: 'расчёт цен',
                    done: 25,
                    total: 100,
                },
            },
        },
    });
    const w = render(j);
    expect(w.text()).toContain('0%');
    expect(w.text()).toContain('Ожидание текущей операции Ozon');
    expect(w.text()).toContain('Проверка акций Ozon: 64%');
    expect(w.text()).toContain('25 из 100');
    expect(w.find('[data-bar]').attributes('data-value')).toBe('0');
});

it('100% с частичной ошибкой не показывает общий успех вместо результатов площадок', () => {
    const j = job();
    j.status = 'done';
    Object.assign(j.progress, {
        percent: 100,
        activities: {
            ozon: { state: 'done', phase: 'Запрос принят площадкой' },
            wb: { state: 'failed', phase: 'Запрос не подтверждён', error: 'API 500' },
        },
    });
    const w = render(j, { doneText: 'Обработка завершена' });
    expect(w.text()).toContain('100%');
    expect(w.text()).toContain('есть ошибки');
    expect(w.text()).toContain('Ozon — Запрос принят площадкой');
    expect(w.text()).toContain('ВБ — Запрос не подтверждён');
    expect(w.find('[data-bar]').exists()).toBe(false);
});
