import {
    lossPriceRetryDelay,
    lossPriceRetryDue,
    LOSS_DATA_RETRY_MS,
    LOSS_TEMPORARY_RETRY_MS,
} from './loss-price.retry';
import {
    matchesPricingInputs,
    mergePricingInputs,
    notifyPricingInputs,
} from '../../helpers/price/pricing-inputs-changed';
const now = Date.parse('2026-11-08T10:00:00Z');
const payload = (retryKind: 'data' | 'temporary' = 'data') => ({
    offerId: '123-5',
    lastError: 'Ошибка',
    retryKind,
    attemptedAt: new Date(now).toISOString(),
    nextAttemptAt: new Date(now + lossPriceRetryDelay(retryKind)).toISOString(),
});
it.each(['data', 'temporary'] as const)('ожидание %s ограничено сроком и переживает сериализацию', (kind) => {
    const value = JSON.parse(JSON.stringify(payload(kind)));
    expect(lossPriceRetryDue(value, false, undefined, now + 1)).toBe(kind === 'temporary');
    expect(lossPriceRetryDue(value, false, undefined, now + lossPriceRetryDelay(kind))).toBe(true);
});
it('ошибки данных проверяются через час, временные — следующим десятиминутным cron', () => {
    expect(LOSS_DATA_RETRY_MS).toBe(3600000);
    expect(LOSS_TEMPORARY_RETRY_MS).toBe(0);
});
it('ручной повтор и подходящее изменение данных обходят ожидание', () => {
    expect(lossPriceRetryDue(payload(), true, undefined, now)).toBe(true);
    expect(lossPriceRetryDue(payload(), false, { offers: ['123-5'] }, now)).toBe(true);
    expect(lossPriceRetryDue(payload(), false, { codes: ['123'] }, now)).toBe(true);
    expect(lossPriceRetryDue(payload(), false, { offers: ['123'] }, now)).toBe(false);
    expect(lossPriceRetryDue(payload(), false, { codes: ['456'] }, now)).toBe(false);
});
it.each([
    undefined,
    {},
    { nextAttemptAt: '2999-01-01', retryKind: 'data', lastError: 'x' },
    { ...payload(), nextAttemptAt: 'bad' },
    { ...payload(), nextAttemptAt: '2999-01-01' },
    { ...payload(), retryKind: 'invalid' },
])('старые и повреждённые метаданные не замораживают задания', (value) => {
    expect(lossPriceRetryDue(value, false, undefined, now)).toBe(true);
});
it('изменения объединяются по фасовкам/кодам, глобальное изменение не сужается', () => {
    expect(matchesPricingInputs('123-1', { offers: ['123'] })).toBe(true);
    expect(matchesPricingInputs('123-5', { offers: ['123'] })).toBe(false);
    expect(matchesPricingInputs('bad', { codes: ['123'] })).toBe(false);
    expect(mergePricingInputs({ offers: ['123'] }, { codes: ['456'] })).toEqual({ offers: ['123'], codes: ['456'] });
    expect(mergePricingInputs({}, { offers: ['123'] })).toEqual({});
});
it('сбой уведомления не выдаётся за откат уже сохранённых данных', () => {
    const error = new Error('listener failed'),
        failed = jest.fn();
    expect(() =>
        notifyPricingInputs(
            {
                emit: () => {
                    throw error;
                },
            } as any,
            {},
            failed,
        ),
    ).not.toThrow();
    expect(failed).toHaveBeenCalledWith(error);
});

it('будущий attemptedAt не замораживает событие из-за повреждения или смены часов', () => {
    expect(
        lossPriceRetryDue(
            { ...payload(), attemptedAt: '2999-01-01T00:00:00Z', nextAttemptAt: '2999-01-01T01:00:00Z' },
            false,
            undefined,
            now,
        ),
    ).toBe(true);
    expect(matchesPricingInputs('123-5', { offers: ['bad', '123-5'] })).toBe(true);
});
