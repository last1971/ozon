import { NotifyMessage, NotifyTopic } from './notify.types';

/**
 * Plain-текст для Matrix из тех же данных, что идут в hbs-шаблон письма.
 * Один источник данных — два представления; второго описания сообщения нет.
 */
export function wbOrdersMessage(subject: string, orders: { prim: string; offer_id: string }[]): NotifyMessage {
    return {
        subject,
        text: orders.map((order) => `${order.prim} — ${order.offer_id}`).join('\n'),
        notice: true,
        mail: { template: 'wb_order_content', context: { orders } },
    };
}

export function halfStoreMessage(good: any, bound: any): NotifyMessage {
    return {
        subject: 'Заканчивается товар',
        text: `За последний месяц продано ${bound?.AMOUNT} шт ${good?.name}\nОстаток ${good?.quantity} шт, резерв ${good?.reserve} шт.`,
        notice: true,
        mail: { template: 'half_store', context: { good, bound } },
    };
}

export function problematicPricesMessage(context: { products: any[]; thresholdPercent: number }): NotifyMessage {
    const products = context?.products ?? [];
    const lines = products.map(
        (p) => `${p.offer_id} ${p.name ?? ''}: маркетинг ${p.marketing_seller_price}, мин ${p.min_price}, ${p.diffPercent}%`,
    );
    return {
        subject: 'Поправить цены',
        text: `Товаров: ${products.length}, порог ${context?.thresholdPercent}%\n${lines.join('\n')}`,
        notice: true,
        mail: { template: 'price_difference_report', context },
    };
}

export function tickMessage(): NotifyMessage {
    return {
        subject: 'Синхронизация с маркетплейсами',
        text: 'Синхронизация с маркетплейсами фунициклирует в штатном режиме',
        notice: true,
        mail: { template: 'tick_message', context: {} },
    };
}

/** m.notice — без пуша: диагностика, цены, финансы. Пуш только там, где человек должен встать и пойти. */
export function isNoticeTopic(topic: NotifyTopic): boolean {
    return topic !== NotifyTopic.OPS && topic !== NotifyTopic.MARKING;
}
