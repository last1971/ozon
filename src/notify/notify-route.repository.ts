import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { NotifyChannel, NotifyRoute } from './notify.types';

/**
 * Только чтение NOTIFY_ROUTE. Таблица одна на базу, значит одна на инсталляцию —
 * её же читает Trade. Кэш 60 с: правка строки действует через минуту, рестарта нет.
 * Ошибка базы не роняет уведомление: отдаём прошлый снимок (или пусто) и пишем в лог.
 */
@Injectable()
export class NotifyRouteRepository {
    static readonly TTL_MS = 60_000;
    private readonly logger = new Logger(NotifyRouteRepository.name);
    private snapshot: { at: number; routes: NotifyRoute[] } | null = null;

    constructor(@Optional() @Inject(FIREBIRD) private readonly pool: FirebirdPool | null) {}

    async routes(): Promise<NotifyRoute[]> {
        if (this.snapshot && Date.now() - this.snapshot.at < NotifyRouteRepository.TTL_MS) {
            return this.snapshot.routes;
        }
        try {
            const routes = await this.load();
            this.snapshot = { at: Date.now(), routes };
            return routes;
        } catch (e) {
            this.logger.error(`NOTIFY_ROUTE не прочитана: ${e.message}`);
            return this.snapshot?.routes ?? [];
        }
    }

    async targets(topic: string, channel: NotifyChannel): Promise<string[]> {
        const wanted = topic.toUpperCase();
        const seen = new Set<string>();
        for (const route of await this.routes()) {
            if (route.topic === wanted && route.channel === channel) seen.add(route.target);
        }
        return [...seen];
    }

    /** Есть ли у темы хоть один адресат — чтобы не собирать письмо впустую. */
    async hasRoutes(topic: string): Promise<boolean> {
        const wanted = topic.toUpperCase();
        return (await this.routes()).some((route) => route.topic === wanted);
    }

    /** Сбросить кэш — после правки таблицы из теста или ручки. */
    invalidate(): void {
        if (this.snapshot) this.snapshot.at = 0;
    }

    private async load(): Promise<NotifyRoute[]> {
        if (!this.pool) return [];
        const transaction = await this.pool.getTransaction();
        try {
            const rows: any[] = await transaction.query(
                'SELECT TOPIC, CHANNEL, TARGET FROM NOTIFY_ROUTE WHERE ENABLED = 1',
                [],
            );
            await transaction.commit(true);
            return rows
                .map((row) => ({
                    topic: String(row.TOPIC ?? '')
                        .trim()
                        .toUpperCase(),
                    channel: String(row.CHANNEL ?? '').trim() as NotifyChannel,
                    target: String(row.TARGET ?? '').trim(),
                }))
                .filter(
                    (route) => route.topic && route.target && (route.channel === 'mail' || route.channel === 'matrix'),
                );
        } catch (e) {
            await transaction.rollback(true).catch(() => undefined);
            throw e;
        }
    }
}
