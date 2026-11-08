import { currentJob, setJobActivity } from '../../job/job.execution';
import { SerialTaskQueue, SerialTaskOptions } from '../serial-task.queue';
import { lossOfferKey } from './marketplace.loss.stats';
import type { PricingInputsChanged } from './pricing-inputs-changed';
export class PricePlanStaleError extends Error {}
export interface PricingSnapshot {
    key: string;
    versions: [string, number][];
}
const offerKey = (offer: string) => {
    try {
        return lossOfferKey(offer);
    } catch {
        return String(offer);
    }
};

/** Та же очередь записи; версии позволяют отклонить план, подготовленный до другой операции. */
export class PriceUpdateQueue extends SerialTaskQueue {
    run<T>(key: string | undefined, operation: () => Promise<T>, options: SerialTaskOptions = {}): Promise<T> {
        const job = currentJob();
        const label = key === 'ozon' ? 'Ozon' : key === 'wb' ? 'ВБ' : key?.toUpperCase();
        const phase =
            job?.progress.activities?.[key]?.phase ?? job?.progress.phase ?? `Проверка актуальности цен ${label}`;
        return super.run(key, operation, {
            ...options,
            owner: job ? { id: job.id, kind: job.kind } : options.owner,
            onWaiting: (waiting, owner) => {
                const activity = setJobActivity(
                    key,
                    waiting ? `Ожидание текущей операции ${label}` : phase,
                    waiting ? 'waiting' : 'running',
                );
                if (activity && waiting && owner && owner.id !== job?.id) activity.waitingFor = { ...owner };
                options.onWaiting?.(waiting, owner);
            },
        });
    }
    private readonly versions = new Map<string, number>();
    reader(key: string, offers?: string[]): (offers: string[]) => PricingSnapshot {
        const versions = offers
            ? new Map(
                  this.capture(key, offers).versions.map(
                      ([scope, version]) => [`${key?.toLowerCase()}:${scope}`, version] as const,
                  ),
              )
            : new Map(this.versions);
        return (offers) => this.snapshot(key, offers, versions);
    }
    capture(key: string, offers: string[]): PricingSnapshot {
        return this.snapshot(key, offers, this.versions);
    }
    private snapshot(key: string, offers: string[], versions: Map<string, number>): PricingSnapshot {
        key = key?.toLowerCase();
        const scopes = new Set([
            '*',
            ...offers.flatMap((o) => [`offer:${offerKey(o)}`, `code:${offerKey(o).split('-')[0]}`]),
        ]);
        return { key, versions: [...scopes].map((s) => [s, versions.get(`${key}:${s}`) ?? 0]) };
    }
    assertCurrent(snapshot: PricingSnapshot): void {
        if (snapshot.versions.some(([s, v]) => (this.versions.get(`${snapshot.key}:${s}`) ?? 0) !== v))
            throw new PricePlanStaleError('План устарел после изменения цены или данных. Подготовьте цены заново.');
    }
    changed(key: string, offers?: string[]): void {
        this.bump(key?.toLowerCase(), offers ? offers.map((o) => `offer:${offerKey(o)}`) : ['*']);
    }
    inputsChanged(change: PricingInputsChanged): void {
        for (const key of change.service
            ? [change.service.toLowerCase()]
            : ['ozon', 'wb', 'yandex', 'avito', 'sylius', 'express']) {
            const scopes =
                !change.offers && !change.codes
                    ? ['*']
                    : [
                          ...(change.offers ?? []).map((o) => `offer:${offerKey(o)}`),
                          ...(change.codes ?? []).map((c) => `code:${c}`),
                      ];
            this.bump(key, scopes);
        }
    }
    private bump(key: string, scopes: string[]) {
        for (const scope of new Set(scopes)) {
            const id = `${key}:${scope}`;
            this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
        }
    }
}
export const priceUpdateQueue = new PriceUpdateQueue();
export function SerializePriceUpdate(key: string) {
    return (_target: unknown, _name: string, descriptor: PropertyDescriptor) => {
        const method = descriptor.value;
        descriptor.value = function (...args: unknown[]) {
            return priceUpdateQueue.run(key, () => method.apply(this, args));
        };
    };
}
