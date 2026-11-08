import { ForbiddenException } from '@nestjs/common';

/** Один переключатель для расписания, ручных команд и последней границы перед API. */
export const PRICING_REVIEW_MESSAGE =
    'Режим проверки цен: отправка цен и изменение акций отключены. Доступны расчёт и сверка без применения.';
export const PRICING_WRITE_CRONS = new Set([
    'updateAllServicePrices',
    'updateOzonPrices',
    'updateWbPrices',
    'updateYandexPrices',
    'ozonPromoSweepMin',
    'wbHoldMinPrices',
    'marketplaceLossPriceRetry',
    'processDiscountRequests',
]);

export function pricingReviewMode(): boolean {
    // Неизвестное непустое значение также закрывает запись; валидация env не даст с ним запуститься.
    const value = process.env.PRICING_REVIEW_MODE;
    return value !== undefined && value !== 'false';
}

export function assertPricingWritesAllowed(): void {
    if (pricingReviewMode()) throw new ForbiddenException(PRICING_REVIEW_MESSAGE);
}

type Platform = 'ozon' | 'wb' | 'yandex' | 'avito' | 'sylius';

/** Проверяет реальные пути записи, включая старые ручки и rawFetch. Чтение POST разрешено. */
export function pricingRequestWrites(platform: Platform, endpoint: string, method: string): boolean {
    if (['get', 'head', 'statistics'].includes(method.toLowerCase())) return false;
    const path = new URL(endpoint, 'https://market.invalid/').pathname.replace(/\/+$/, '').toLowerCase();
    let writes = false;
    switch (platform) {
        case 'ozon':
            writes =
                /^\/v\d+\/product\/import(?:\/prices)?$/.test(path) ||
                /^\/v\d+\/product\/price-strategy(?:\/|$)/.test(path);
            if (/^\/v\d+\/(?:actions|seller-actions)(?:\/|$)/.test(path)) {
                writes =
                    !/^\/v\d+\/(?:actions(?:\/(?:products|candidates|discounts-task\/list))?|seller-actions\/(?:list|products\/(?:list|candidates)))$/.test(
                        path,
                    );
            }
            break;
        case 'wb':
            writes =
                /^\/api\/v\d+\/(?:upload|calendar\/promotions\/upload)(?:\/|$)/.test(path) ||
                /^\/content\/v\d+\/cards\/upload(?:\/add)?$/.test(path) ||
                /^\/public\/api\/v\d+\/(?:prices|updatediscounts|revokediscounts)$/.test(path);
            break;
        case 'yandex':
            writes =
                /\/(?:offer-prices|offers)\/(?:updates?|delete)$/.test(path) || /\/offer-mappings\/update$/.test(path);
            break;
        case 'avito':
            writes = /\/update_price$/.test(path);
            break;
        case 'sylius':
            writes = /\/price\/update$/.test(path);
            break;
    }
    return writes;
}
export function assertPricingRequestAllowed(platform: Platform, endpoint: string, method: string): void {
    if (pricingReviewMode() && pricingRequestWrites(platform, endpoint, method)) assertPricingWritesAllowed();
}
