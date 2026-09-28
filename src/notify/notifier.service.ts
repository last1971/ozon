import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Environment } from '../env.validation';
import {
    halfStoreMessage,
    isNoticeTopic,
    problematicPricesMessage,
    tickMessage,
    wbOrdersMessage,
} from './formatters';
import { instanceTag, resolveInstance } from './instance';
import { NotifyRetryService } from './notify-retry.service';
import { NotifyRouteRepository } from './notify-route.repository';
import { INotifyTransport, NOTIFY_TRANSPORTS, NotifyChannel, NotifyMessage, NotifyTopic } from './notify.types';
import { MatrixTransport } from './matrix.transport';

/**
 * Единственное место, где тема превращается в адресатов. Слушает те же события
 * шины, что раньше слушал MailService; точки отправки о каналах не знают —
 * только тему (третий аргумент error.message, по умолчанию DEV).
 * Не в production транспорты только логируют: локальный запуск смотрит в
 * ПРОД-базу, и таблица маршрутов там — боевые комнаты.
 */
@Injectable()
export class NotifierService {
    static readonly DEDUP_TTL_MS = 30 * 60_000;
    private readonly logger = new Logger(NotifierService.name);
    private readonly transports: Map<NotifyChannel, INotifyTransport>;
    private readonly tag: string;
    private readonly live: boolean;

    constructor(
        @Inject(NOTIFY_TRANSPORTS) transports: INotifyTransport[],
        private readonly routes: NotifyRouteRepository,
        private readonly retry: NotifyRetryService,
        private readonly matrix: MatrixTransport,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        config: ConfigService,
    ) {
        this.transports = new Map(transports.map((t) => [t.channel, t]));
        this.tag = instanceTag(resolveInstance(config));
        this.live = config.get<Environment>('NODE_ENV') === Environment.Production;
    }

    async notify(topic: NotifyTopic, message: NotifyMessage): Promise<boolean> {
        const tagged: NotifyMessage = {
            ...message,
            subject: `${this.tag} ${message.subject}`,
            notice: message.notice ?? isNoticeTopic(topic),
        };
        if (!(await this.routes.hasRoutes(topic))) {
            this.logger.warn(`у темы ${topic} нет маршрутов: «${message.subject}»`);
            return false;
        }
        // Дедуп только DEV и только после проверки маршрутов: сообщение, которое никуда
        // не ушло, не должно глушить такое же после появления маршрута.
        if (topic === NotifyTopic.DEV && (await this.isDuplicate(tagged))) {
            this.logger.debug(`повтор за 30 мин пропущен: «${message.subject}»`);
            return false;
        }
        let delivered = false;
        for (const [channel, transport] of this.transports) {
            for (const target of await this.routes.targets(topic, channel)) {
                if (!this.live) {
                    this.logger.log(`не прод, ${channel} пропущен: ${target} «${tagged.subject}»`);
                    delivered = true;
                    continue;
                }
                const ok = await transport.send(target, tagged);
                if (!ok && channel === 'matrix') await this.retry.enqueue(target, tagged);
                delivered = delivered || ok;
            }
        }
        return delivered;
    }

    /**
     * Ручка проверки. С явной комнатой шлёт напрямую, мимо таблицы и гейта —
     * локально иначе ничего не проверить. Без комнаты — обычный путь по теме.
     */
    async test(topic: NotifyTopic, room?: string): Promise<{ ok: boolean; detail?: string }> {
        const message: NotifyMessage = {
            subject: `Проверка темы ${topic}`,
            text: `Если вы это видите — маршрут и токен живые. ${new Date().toLocaleString('ru-RU')}`,
            notice: true,
        };
        if (room) {
            const result = await this.matrix.deliver(room, { ...message, subject: `${this.tag} ${message.subject}` });
            return { ok: result.ok, detail: result.ok ? 'в комнате' : `${result.status ?? '—'} ${result.error}` };
        }
        return { ok: await this.notify(topic, message) };
    }

    @OnEvent('error.message', { async: true })
    async errorMessage(subject: string, message: string, topic: NotifyTopic = NotifyTopic.DEV): Promise<boolean> {
        return this.notify(topic, { subject, text: message ?? '' });
    }

    @OnEvent('wb.order.content', { async: true })
    async wbOrders(subject: string, orders: any[]): Promise<boolean> {
        return this.notify(NotifyTopic.OPS, wbOrdersMessage(subject, orders ?? []));
    }

    @OnEvent('half.store', { async: true })
    async halfStore(good: any, bound: any): Promise<boolean> {
        return this.notify(NotifyTopic.PRICES, halfStoreMessage(good, bound));
    }

    @OnEvent('problematic.prices', { async: true })
    async problematicPrices(context: any): Promise<boolean> {
        return this.notify(NotifyTopic.PRICES, problematicPricesMessage(context));
    }

    /** Время задаёт cron.setup.ts (в production — раз в 3 часа), декоратор — заглушка. */
    @Cron('0 0 9-19 * * 1-6', { name: 'checkHealth' })
    async checkHealth(): Promise<boolean> {
        return this.notify(NotifyTopic.DEV, tickMessage());
    }

    private async isDuplicate(message: NotifyMessage): Promise<boolean> {
        try {
            const hash = createHash('sha1').update(`${message.subject}\n${message.text}`).digest('hex');
            const key = `notify:dedup:${hash}`;
            if (await this.cache.get(key)) return true;
            await this.cache.set(key, 1, NotifierService.DEDUP_TTL_MS);
        } catch (e) {
            this.logger.warn(`дедуп недоступен: ${e.message}`);
        }
        return false;
    }
}
