import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailTransport } from './mail.transport';
import { MatrixTransport } from './matrix.transport';
import { NotifyRouteRepository } from './notify-route.repository';
import { NotifyMessage, NotifyTopic } from './notify.types';
import { instanceTag, resolveInstance } from './instance';

interface RetryItem {
    ts: number;
    room: string;
    message: NotifyMessage;
}

/**
 * Неотправленное в Matrix не теряется: лежит в Redis (одним JSON-ключом через
 * CACHE_MANAGER — списков у cache-manager нет, паттерн как ProcessedCacheService)
 * и повторяется раз в минуту по порядку. Первая же неудача останавливает проход.
 * Старше суток — выброс с логом. Молчит Matrix дольше N минут — одно письмо
 * по теме DEV, следующее только после восстановления.
 */
@Injectable()
export class NotifyRetryService {
    static readonly KEY = 'notify:retry';
    static readonly DOWN_SINCE_KEY = 'notify:matrix_down_since';
    static readonly DOWN_ALERTED_KEY = 'notify:matrix_down_alerted';
    static readonly TTL_HOURS = 24;
    static readonly DOWN_ALERT_MINUTES = 10;
    private readonly logger = new Logger(NotifyRetryService.name);
    private readonly tag: string;

    constructor(
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        private readonly matrix: MatrixTransport,
        private readonly mail: MailTransport,
        private readonly routes: NotifyRouteRepository,
        config: ConfigService,
    ) {
        this.tag = instanceTag(resolveInstance(config));
    }

    async enqueue(room: string, message: NotifyMessage): Promise<void> {
        const items = await this.load();
        items.push({ ts: Date.now(), room, message });
        await this.save(items);
        await this.markDown();
    }

    async size(): Promise<number> {
        return (await this.load()).length;
    }

    @Cron(CronExpression.EVERY_MINUTE, { name: 'notifyRetry' })
    async retry(): Promise<{ sent: number; dropped: number; left: number }> {
        const items = await this.load();
        if (items.length === 0) return { sent: 0, dropped: 0, left: 0 };
        const ttl = NotifyRetryService.TTL_HOURS * 3600_000;
        let sent = 0;
        let dropped = 0;
        const left: RetryItem[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (Date.now() - item.ts > ttl) {
                this.logger.warn(`повтор просрочен, выброшен: ${item.room} «${item.message.subject}»`);
                dropped++;
                continue;
            }
            const at = new Date(item.ts).toTimeString().slice(0, 5);
            const delayed = { ...item.message, subject: `(с ${at}, доставлено с задержкой) ${item.message.subject}` };
            const result = await this.matrix.deliver(item.room, delayed);
            if (!result.ok) {
                left.push(...items.slice(i));
                break;
            }
            sent++;
        }
        await this.save(left);
        if (left.length > 0) await this.markDown();
        else await this.markUp();
        if (sent || dropped) this.logger.log(`notify:retry отправлено ${sent}, выброшено ${dropped}, осталось ${left.length}`);
        return { sent, dropped, left: left.length };
    }

    async markUp(): Promise<void> {
        await this.cache.del(NotifyRetryService.DOWN_SINCE_KEY);
        await this.cache.del(NotifyRetryService.DOWN_ALERTED_KEY);
    }

    private async markDown(): Promise<void> {
        try {
            let since = await this.cache.get<number>(NotifyRetryService.DOWN_SINCE_KEY);
            if (!since) {
                since = Date.now();
                await this.cache.set(NotifyRetryService.DOWN_SINCE_KEY, since, 0);
            }
            if (Date.now() - since < NotifyRetryService.DOWN_ALERT_MINUTES * 60_000) return;
            if (await this.cache.get(NotifyRetryService.DOWN_ALERTED_KEY)) return;
            await this.cache.set(NotifyRetryService.DOWN_ALERTED_KEY, 1, 0);
            const targets = await this.routes.targets(NotifyTopic.DEV, 'mail');
            const when = new Date(since).toLocaleString('ru-RU');
            if (targets.length === 0) {
                this.logger.error(`Matrix недоступен с ${when}, письмо слать некому (нет DEV/mail)`);
                return;
            }
            for (const target of targets) {
                await this.mail.send(target, {
                    subject: `${this.tag} Matrix недоступен`,
                    text: `Matrix не отвечает с ${when}. Сообщения копятся в очереди повтора.`,
                });
            }
        } catch (e) {
            this.logger.error(`не удалось отметить падение Matrix: ${e.message}`);
        }
    }

    private async load(): Promise<RetryItem[]> {
        try {
            const raw = await this.cache.get<string>(NotifyRetryService.KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            this.logger.error(`очередь повтора не прочитана: ${e.message}`);
            return [];
        }
    }

    private async save(items: RetryItem[]): Promise<void> {
        try {
            if (items.length === 0) await this.cache.del(NotifyRetryService.KEY);
            else await this.cache.set(NotifyRetryService.KEY, JSON.stringify(items), (NotifyRetryService.TTL_HOURS + 1) * 3600_000);
        } catch (e) {
            this.logger.error(`очередь повтора не записана: ${e.message}`);
        }
    }
}
