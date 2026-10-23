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
        (p) =>
            `${p.mark} ${p.diffLabel}% ${p.offer_id} ${p.name ?? ''}: маркетинг ${p.marketing_seller_price}, мин ${p.min_price}`,
    );
    return {
        subject: 'Поправить цены',
        text: `Товаров: ${products.length}, порог ${context?.thresholdPercent}%\n🟢 в нашу пользу, 🔴 в пользу маркетплейса\n${lines.join('\n')}`,
        notice: true,
        mail: { template: 'price_difference_report', context: { ...context, products } },
    };
}

/**
 * Проверка прибыльности заказов (ProfitCheckService). Один проход — одно сообщение:
 * сперва тревоги (прибыли нет), потом предупреждения (ниже минимальной), потом «не проверено».
 * Пуш только если есть хоть одна тревога.
 */
export function profitCheckMessage(items: any[]): NotifyMessage {
    const alerts = items.filter((i) => i.level === 'alert');
    const warns = items.filter((i) => i.level === 'warn');
    const skips = items.filter((i) => i.level === 'skip');
    const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n)));
    const head = (i: any) =>
        `${i.payload?.service} ${i.posting}${i.payload?.invoiceNumber ? ` · счёт №${i.payload.invoiceNumber}` : ''}` +
        (i.payload?.priceOrigin === 'card' ? ' · цена из карточки на момент проверки, статистика заказ не отдала' : '');
    const lineOf = (v: any) =>
        v.level === 'skip'
            ? `  ${v.offer_id} × ${v.units}: не проверено — ${v.reason}`
            : `  ${v.offer_id} × ${v.units}: цена ${fmt(v.pricePerUnit)}, мин ${fmt(v.minPrice)}, ` +
              `себестоимость ${fmt(v.cost)} (${v.costSource}), прибыль ${fmt(v.profitPerUnit)} за шт, итого ${fmt(v.profitTotal)}`;
    const block = (title: string, list: any[]) =>
        list.length
            ? [
                  title,
                  ...list.map((i) =>
                      [
                          head(i),
                          ...(i.verdicts ?? []).map(lineOf),
                          ...(i.reason && !i.verdicts ? [`  ${i.reason}`] : []),
                      ].join('\n'),
                  ),
              ]
            : [];
    const parts = [
        ...block(`🔴 ПРИБЫЛИ НЕТ: ${alerts.length}`, alerts),
        ...block(`🟡 Ниже минимальной цены: ${warns.length}`, warns),
        ...block(`⚪ Не проверено: ${skips.length}`, skips),
    ];
    const subject = alerts.length
        ? `Заказ без прибыли: ${alerts.length}${warns.length ? `, ниже минимальной ${warns.length}` : ''}`
        : warns.length
          ? `Заказы ниже минимальной цены: ${warns.length}`
          : `Прибыльность заказов: не проверено ${skips.length}`;
    return { subject, text: parts.join('\n'), notice: alerts.length === 0 };
}

/** Сколько строк списка показать в сообщении, остальное — «и ещё N». */
const LIST_LIMIT = 20;
const listed = (lines: string[]): string[] =>
    lines.length > LIST_LIMIT ? [...lines.slice(0, LIST_LIMIT), `  … и ещё ${lines.length - LIST_LIMIT}`] : lines;

/** Сторож ВБ: что поменяли, чтобы покупатель видел минимальную. Тихо — без пуша. */
export function wbMinPricesMessage(report: {
    changes: { article: string; from: number; to: number; buyerAfter: number }[];
    belowMin: string[];
    errors: string[];
    uploadId: string | null;
}): NotifyMessage {
    const up = report.changes.filter((c) => c.to < c.from);
    const down = report.changes.filter((c) => c.to > c.from);
    const row = (c: { article: string; from: number; to: number; buyerAfter: number }) =>
        `  ${c.article}: скидка ${c.from} → ${c.to} %, покупателю ${c.buyerAfter}`;
    const parts = [
        ...(up.length ? [`⬆ Подняли до минимальной (акция ВБ опустила): ${up.length}`, ...listed(up.map(row))] : []),
        ...(down.length ? [`⬇ Опустили до минимальной: ${down.length}`, ...listed(down.map(row))] : []),
        ...(report.belowMin.length
            ? [
                  `🟡 База «до скидки» ниже минимальной — нужен пересчёт цены: ${report.belowMin.length}`,
                  ...listed(report.belowMin.map((a) => `  ${a}`)),
              ]
            : []),
        ...(report.errors.length ? [`Не трогали (нет минимальной и др.): ${report.errors.length}`] : []),
        `Задача ВБ: ${report.uploadId ?? '—'}`,
    ];
    return {
        subject: `ВБ к минимальной: подняли ${up.length}, опустили ${down.length}`,
        text: parts.join('\n'),
        notice: true,
    };
}

/** Сверка акций Ozon с применением: что поменяли и что не прошло. Тихо — без пуша. */
export function ozonPromoSweepMessage(report: {
    items: { offerId: string; applied?: boolean; steps: unknown[]; results?: { status: string; reason?: string }[] }[];
    keptInOzon: number;
    removedFromOzon: number;
    percentChanged: number;
    nothingToDo: number;
}): NotifyMessage {
    const tried = report.items.filter((i) => i.steps.length && i.applied !== undefined);
    const ok = tried.filter((i) => i.applied);
    const failed = tried.filter((i) => !i.applied);
    const reason = (i: (typeof failed)[number]) => i.results?.find((r) => r.status !== 'ok')?.reason ?? 'не прошло';
    const parts = [
        `Применено: ${ok.length} (меняли наш процент ${report.percentChanged}, остались в акциях Ozon ${report.keptInOzon}, ` +
            `выкинуты из акций Ozon ${report.removedFromOzon})`,
        ...listed(ok.map((i) => `  ${i.offerId}`)),
        ...(failed.length
            ? [`🟡 Не прошло: ${failed.length}`, ...listed(failed.map((i) => `  ${i.offerId}: ${reason(i)}`))]
            : []),
        ...(report.nothingToDo ? [`Смотреть руками: ${report.nothingToDo}`] : []),
    ];
    return {
        subject: `Озон акции к минимальной: применено ${ok.length}${failed.length ? `, не прошло ${failed.length}` : ''}`,
        text: parts.join('\n'),
        notice: true,
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
