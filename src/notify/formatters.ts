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

/** Цвет и подпись строки: «+» — маркетинговая выше минимальной, в нашу пользу; «−» — в пользу маркетплейса. */
function priceRow(p: any) {
    const ours = Number(p.diffPercent) > 0;
    return {
        ...p,
        diffLabel: `${ours ? '+' : '−'}${Math.abs(Number(p.diffPercent))}`,
        rowColor: ours ? '#e3f4e1' : '#fbe3e3',
        mark: ours ? '🟢' : '🔴',
    };
}

export function problematicPricesMessage(context: { products: any[]; thresholdPercent: number }): NotifyMessage {
    const products = (context?.products ?? []).map(priceRow);
    const lines = products.map(
        (p) => `${p.mark} ${p.diffLabel}% ${p.offer_id} ${p.name ?? ''}: маркетинг ${p.marketing_seller_price}, мин ${p.min_price}`,
    );
    return {
        subject: 'Поправить цены',
        text: `Товаров: ${products.length}, порог ${context?.thresholdPercent}%\n🟢 в нашу пользу, 🔴 в пользу маркетплейса\n${lines.join('\n')}`,
        notice: true,
        mail: { template: 'price_difference_report', context: { ...context, products } },
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
