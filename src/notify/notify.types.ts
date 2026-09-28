/**
 * Уведомления: тема → адресаты из таблицы NOTIFY_ROUTE (патч 56) → транспорт.
 * Тема = «кто реагирует», не маркетплейс и не тип события. Новая тема — это
 * строка в таблице плюс указание темы в точке отправки; код маршрутизации не меняется.
 */
export enum NotifyTopic {
    /** Действия менеджера/кладовщика: разобрать посылку, недобор, отмена собранного. */
    OPS = 'OPS',
    /** Всё про коды Честного знака. */
    MARKING = 'MARKING',
    /** Цены и остатки. */
    PRICES = 'PRICES',
    /** Начисления Ozon. */
    FINANCE = 'FINANCE',
    /** Техническая диагностика для владельца — сюда же всё, у чего темы нет. */
    DEV = 'DEV',
}

export type NotifyChannel = 'mail' | 'matrix';

export interface NotifyMessage {
    subject: string;
    /** Plain-текст: тело сообщения Matrix и письмо без шаблона. */
    text: string;
    /** formatted_body для Matrix; без него text экранируется и переносы становятся <br>. */
    html?: string;
    /** m.notice — без пуша; для DEV/PRICES/FINANCE. */
    notice?: boolean;
    /** Письмо по hbs-шаблону из src/mail/templates; без него — error_message с {message: text}. */
    mail?: { template: string; context: Record<string, any> };
}

export interface NotifyRoute {
    topic: string;
    channel: NotifyChannel;
    target: string;
}

/** Транспорт одного канала. Новый канал = новый класс с этим интерфейсом, NotifierService не меняется. */
export interface INotifyTransport {
    readonly channel: NotifyChannel;
    /** true — доставлено; false — нет, и транспорт сам НЕ повторяет: это очередь. */
    send(target: string, message: NotifyMessage): Promise<boolean>;
}

export const NOTIFY_TRANSPORTS = 'NOTIFY_TRANSPORTS';

export type NotifyInstance = 'opt' | 'shop';
