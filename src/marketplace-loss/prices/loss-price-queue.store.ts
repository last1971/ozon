import { PricingFailureKind } from '../../helpers/price/pricing-error';
import { lossPriceRetryDelay } from './loss-price.retry';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebirdTransaction } from 'ts-firebird';
import { MpEventService, MpEventRowDto } from '../../mp-event/mp-event.service';
import { MarketplaceLossRow, lossOfferKey } from '../../helpers/price/marketplace.loss.stats';
import { StoredLossRow } from '../loss.contracts';
import { lossPriceSignature } from './loss-price.signature';
import {
    LOSS_PRICE_KIND,
    LOSS_PRICE_PENDING,
    LOSS_SAVED_EVENT,
    LossPriceMarket,
    LossPricePayload,
} from './loss-price.contracts';

/** Устойчивая очередь в существующем журнале, отдельно от формул и API площадок. */
@Injectable()
export class LossPriceQueueStore {
    private readonly logger = new Logger(LossPriceQueueStore.name);
    constructor(
        private readonly journal: MpEventService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}
    async enqueueChanges(
        service: string,
        calculatedAt: Date,
        previous: StoredLossRow[],
        rows: MarketplaceLossRow[],
        transaction: FirebirdTransaction,
        checkpoint?: () => Promise<void>,
    ) {
        if (service !== 'OZON' && service !== 'WB') return [];
        const before = new Map(previous.map((r) => [lossOfferKey(r.offerId), r]));
        const after = new Map(rows.map((r) => [lossOfferKey(r.offerId), r]));
        const changedOffers: string[] = [];
        let count = 0;
        for (const offerId of new Set([...before.keys(), ...after.keys()])) {
            if (count++ % 50 === 0) await checkpoint?.();
            if (lossPriceSignature(service, before.get(offerId)) === lossPriceSignature(service, after.get(offerId)))
                continue;
            changedOffers.push(offerId);
            const payload: LossPricePayload = { version: 1, offerId, calculatedAt: calculatedAt.toISOString() };
            // Версия снимка проверена под блокировкой MP_LOSS_STATE: это всегда новый ключ события.
            await this.journal.recordNew(
                {
                    service,
                    kind: LOSS_PRICE_KIND,
                    state: LOSS_PRICE_PENDING,
                    extId: `${calculatedAt.getTime()}:${offerId}`,
                    payload,
                },
                transaction,
            );
        }
        return changedOffers;
    }
    committed(service: string, changedOffers?: string[]) {
        if (service !== 'OZON' && service !== 'WB') return;
        // Ошибка уведомления не выдаётся за rollback уже сохранённого снимка. Заявка останется в БД.
        try {
            this.events?.emit(LOSS_SAVED_EVENT, service, changedOffers);
        } catch (error) {
            this.logger.error(`Заявки цен сохранены, запуск обработки не удался: ${error.message}`);
        }
    }
    pending(service: LossPriceMarket) {
        return this.journal.listUnhandledRows(service, LOSS_PRICE_KIND, LOSS_PRICE_PENDING);
    }
    async finish(
        service: LossPriceMarket,
        event: MpEventRowDto,
        error?: string,
        retryKind: PricingFailureKind = 'temporary',
    ) {
        const key = { service, kind: LOSS_PRICE_KIND, state: LOSS_PRICE_PENDING, extId: event.extId } as const;
        if (!error) return this.journal.markHandled(key);
        const payload = event.payload as LossPricePayload;
        const now = Date.now();
        await this.journal.updatePendingPayload(key, {
            ...payload,
            attempts: (Number.isSafeInteger(payload?.attempts) ? payload.attempts : 0) + 1,
            lastError: error,
            attemptedAt: new Date(now).toISOString(),
            retryKind,
            nextAttemptAt: new Date(now + lossPriceRetryDelay(retryKind)).toISOString(),
        });
    }
}
