import { PricingSnapshot } from '../../helpers/price/price-update.queue';
import type { PricingFailureKind } from '../../helpers/price/pricing-error';
import type { PricingInputsChanged } from '../../helpers/price/pricing-inputs-changed';
import { IJobContext } from '../../interfaces/i.job.context';
import { IPriceUpdateable } from '../../interfaces/i.price.updateable';
import { UpdatePriceDto } from '../../price/dto/update.price.dto';
import { MpEventRowDto } from '../../mp-event/mp-event.service';

export const LOSS_PRICE_KIND = 'LOSS_PRICE';
export const LOSS_PRICE_PENDING = 'pending';
export const LOSS_SAVED_EVENT = 'marketplace.loss.saved';
export type LossPriceMarket = 'OZON' | 'WB';
export interface LossPricePayload {
    version: 1;
    offerId: string;
    calculatedAt: string;
    attempts?: number;
    lastError?: string;
    attemptedAt?: string;
    nextAttemptAt?: string;
    retryKind?: PricingFailureKind;
}
export interface LossPriceTask {
    offerId: string;
    events: MpEventRowDto[];
    targets: UpdatePriceDto[];
    changed: UpdatePriceDto[];
    error?: string;
    failureKind?: PricingFailureKind;
    deferred?: boolean;
    snapshot?: PricingSnapshot;
}
/** Адаптер отвечает за протокол площадки, общая цепочка — за очередь и порядок фаз. */
export type LossPriceResult = string | { message: string; kind: PricingFailureKind } | null;
export interface LossPriceAdapter {
    readonly pricing: IPriceUpdateable;
    readonly promoBatchSize?: number;
    offers(): Promise<string[]>;
    current(offers: string[]): Promise<Map<string, unknown>>;
    matches(target: UpdatePriceDto, actual: unknown): boolean;
    persist(targets: UpdatePriceDto[]): Promise<void>;
    send(targets: UpdatePriceDto[], current?: Map<string, unknown>): Promise<Map<string, LossPriceResult>>;
    promos(offers: string[], snapshots?: Map<string, PricingSnapshot>): Promise<Map<string, LossPriceResult>>;
}
export const LOSS_PRICE_ADAPTERS = Symbol('LOSS_PRICE_ADAPTERS');
export interface LossPriceContext extends IJobContext {
    service: LossPriceMarket;
    adapter: LossPriceAdapter;
    tasks: LossPriceTask[];
    current?: Map<string, unknown>;
    sent: number;
    forceRetry?: boolean;
    wake?: PricingInputsChanged;
}
export const lossPriceJobKind = (service: string) => `loss-price-update:${service.toLowerCase()}`;
export function lossPriceMarket(service: string): LossPriceMarket {
    const key = service.toUpperCase();
    if (key !== 'OZON' && key !== 'WB') throw new Error('Обновление цен по статистике доступно только Ozon и ВБ');
    return key;
}
