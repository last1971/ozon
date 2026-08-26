import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { hasReturnsByPostings, IReturnsByPostings } from '../interfaces/IReturnable';
import { ReturnDto } from '../posting/dto/return.dto';
import { PostingService } from '../posting/posting.service';
import { donorSuffixFor } from '../helpers/order.cancellation.constants';
import { MpService } from '../mp-event/mp-event.service';
import { returnWhereabouts } from '../mp-decision/mp-decision.types';

/** Строка письма плюс всё, что нужно, чтобы положить её в правильный раздел. */
interface BoxRow {
    scode: number;
    line: string;
    /** Суффикс донорской пометки СВОЕГО маркетплейса: ВБ-счёт озоновским помечать нельзя. */
    donorMark: string;
}

type Bucket = 'arrived' | 'lost' | 'inTransit' | 'dismantled';

/**
 * Суточная сверка: счёт помечен « отмена» («товар у нас»), а маркетплейс завёл возврат.
 *
 * Значит коробку всё-таки сдали, и пометка врёт: донорский отбор ищет « отмена FBO»
 * (`findFboPodbposCandidates`), этот счёт донором не увидит, и FBO-продажа спишет
 * полочный остаток, которого нет.
 *
 * Сверка НИЧЕГО не исправляет — только письмо. Решение владельца 26.08.2026: случай
 * редкий (за три месяца 2 счёта из 84 помеченных — №16713 и №16559, оба 25–26.08),
 * а автоматика упирается в цену: обратного хода у марки в базе нет вовсе, его пришлось
 * бы заводить процедурой. Исправление руками занимает минуты; если случаи станут
 * регулярными, план автоматики написан и обстрелян (`~/.claude/plans`).
 *
 * Отдельный сервис, а не метод `OrderService`: тот и так god-object на 900+ строк,
 * а жанр «крон + отчёт + письмо» в проекте уже живёт отдельно (`StuckCodesService`).
 *
 * Дедупа нет намеренно: счёт уходит из выборки сам, как только пометку исправят
 * (« отмена FBO» под `LIKE '% отмена'` не подпадает) или счёт закроют. Пока не
 * исправлен — напоминает каждый день, и это ровно то, что нужно.
 *
 * ЗАДЕРЖКА ДО СУТОК — осознанный компромисс. Ту же запись возврата видит пятиминутка
 * (`processReturns` → решающая таблица), и сигнал можно было бы поднимать там же,
 * мгновенно и с готовым дедупом по состоянию. Но это правка боевых веток возвратов
 * ради случая, который случается раз в квартал, — на такое размен не сделан.
 */
@Injectable()
export class CancelledBoxReconcilerService {
    private readonly logger = new Logger(CancelledBoxReconcilerService.name);

    /** Глубина сверки: дальше пометку уже никто не правит. */
    private static readonly CHECK_DAYS = 90;

    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly postingService: PostingService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Кого спрашиваем. Только маркетплейсы с ТОЧЕЧНОЙ ручкой «возвраты по номерам»:
     * у ВБ её нет (заявки приходят пачкой и матчатся на заказы у нас, окном в 120 дней),
     * и фильтр поверх общего списка тихо пропускал бы то, что в окно не попало.
     * Лучше честно не покрыт, чем покрыт на словах.
     */
    private sources(): { service: IReturnsByPostings; mp: MpService }[] {
        return hasReturnsByPostings(this.postingService)
            ? [{ service: this.postingService, mp: 'OZON' as MpService }]
            : [];
    }

    // 04:22 — боевое время задаёт cron.setup.ts: мимо суточного FBO-прохода и пятиминуток.
    @Cron('0 22 4 * * *', { name: 'reconcileCancelledBoxes' })
    async report(): Promise<void> {
        try {
            await this.run();
        } catch (e) {
            // Отчёт необязательный, но молча не отработать он не имеет права:
            // тот же паттерн, что у недельного отчёта подвисших кодов.
            this.logger.error(`сверка отменённых не собрана — ${e.message}`);
            this.eventEmitter.emit('error.message', 'Сверка отменённых счетов не собрана', e.message);
        }
    }

    private async run(): Promise<void> {
        const invoices = await this.invoiceService.findPlainCancelledInvoices(
            CancelledBoxReconcilerService.CHECK_DAYS,
        );
        if (!invoices.length) return;

        const buckets = await this.collect(invoices);
        const total = Object.values(buckets).reduce((sum, rows) => sum + rows.length, 0);
        if (!total) return;

        this.logger.warn(
            `сверка отменённых: доехало ${buckets.arrived.length}, в пути ${buckets.inTransit.length}, ` +
                `не доедет ${buckets.lost.length}, счёт расформирован ${buckets.dismantled.length}`,
        );
        this.eventEmitter.emit(
            'error.message',
            `Коробка уехала к маркетплейсу, а счёт помечен « отмена»: ${total}`,
            CancelledBoxReconcilerService.buildLetter(buckets),
        );
    }

    /**
     * Спросить маркетплейсы про подозрительные счета и разложить ответ по разделам.
     *
     * Корзины `returnWhereabouts` раскладываются ЯВНО, каждая — сознательно:
     *  - `towards-seller` — товар у нас или едет к нам, пометка « отмена» ВЕРНА, молчим
     *    (2 из 49 возвратов за 13 дней выглядели именно так);
     *  - `claim` — заявка, физики не было вовсе: тревожить не о чем, а «исправить» нечего,
     *    и без отсева письмо ходило бы каждый день до конца окна;
     *  - `lost` — товар не доедет ни до кого (списан, утилизирован, потерян у маркетплейса);
     *  - `at-marketplace` — доехал, пометку пора менять;
     *  - `towards-marketplace` и `unknown` — едет либо направление неизвестно: ждём.
     *
     * Строка — одна на СЧЁТ, а не на запись возврата: у отправления бывает несколько
     * записей (по одной на единицу товара), и счёт на четыре единицы дал бы четыре
     * почти одинаковых строки, а при разных состояниях записей попал бы сразу в два
     * раздела со взаимоисключающими советами.
     */
    private async collect(
        invoices: Awaited<ReturnType<IInvoice['findPlainCancelledInvoices']>>,
    ): Promise<Record<Bucket, string[]>> {
        // Один номер отправления встречается у нескольких счетов (на проде 168 таких
        // среди живых) — Map<posting, счёт> потеряла бы все, кроме последнего.
        const byPosting = new Map<string, typeof invoices>();
        for (const invoice of invoices) {
            byPosting.set(invoice.posting, [...(byPosting.get(invoice.posting) ?? []), invoice]);
        }

        const perInvoice = new Map<number, { bucket: Bucket; row: BoxRow; notes: string[] }>();

        for (const { service, mp } of this.sources()) {
            let returns: ReturnDto[];
            try {
                returns = await service.listReturnsByPostings([...byPosting.keys()]);
            } catch (e) {
                // Маркетплейс не ответил — значит просто не сверили в этот раз.
                // Ронять весь отчёт и молчать про остальных нельзя.
                this.logger.warn(`сверка отменённых: ${mp} не ответил — ${e.message}`);
                continue;
            }
            for (const item of returns) {
                const state = item.visual?.status?.sys_name ?? '?';
                // Где товар — решает одна функция; здесь только «что делать с ответом».
                const where = returnWhereabouts(state);
                if (where === 'towards-seller' || where === 'claim') continue;
                for (const invoice of byPosting.get(String(item.posting_number)) ?? []) {
                    const prev = perInvoice.get(invoice.scode);
                    const notes = [...(prev?.notes ?? []), CancelledBoxReconcilerService.note(item, state)];
                    // Счёт расформирован — товар уже разложили по полкам, а он у маркетплейса:
                    // это фантомный остаток, и он важнее любого «доехало/в пути».
                    const bucket: Bucket =
                        invoice.status === 0
                            ? 'dismantled'
                            : where === 'at-marketplace'
                              ? 'arrived'
                              : where === 'lost'
                                ? 'lost'
                                : 'inTransit';
                    perInvoice.set(invoice.scode, {
                        // Одна запись доехала, другая ещё едет — счёт считается доехавшим:
                        // раздел выбирается по «сильнейшему» состоянию, а не по последнему.
                        bucket: CancelledBoxReconcilerService.stronger(prev?.bucket, bucket),
                        notes,
                        row: {
                            scode: invoice.scode,
                            donorMark: donorSuffixFor(mp).trim(),
                            line:
                                `счёт №${invoice.number ?? '?'} (SCODE ${invoice.scode}), ${invoice.posting}: ` +
                                notes.join('; '),
                        },
                    });
                }
            }
        }

        const out: Record<Bucket, string[]> = { arrived: [], inTransit: [], lost: [], dismantled: [] };
        for (const { bucket, row } of perInvoice.values()) out[bucket].push(row.line);
        return out;
    }

    /** Приоритет разделов: фантом важнее всего, дальше «доехало», «не доедет», «едет». */
    private static stronger(prev: Bucket | undefined, next: Bucket): Bucket {
        const rank: Record<Bucket, number> = { dismantled: 4, arrived: 3, lost: 2, inTransit: 1 };
        return !prev || rank[next] > rank[prev] ? next : prev;
    }

    private static note(item: ReturnDto, state: string): string {
        const route =
            item.place?.name || item.target_place?.name
                ? `, маршрут ${item.place?.name ?? '?'} → ${item.target_place?.name ?? '?'}`
                : '';
        return `${item.type ?? 'возврат'} ${item.schema ?? ''}, состояние ${state}${route}`.replace(/\s+/g, ' ');
    }

    /** Текст письма — отдельно от сбора данных: правится глазами, проверяется строкой. */
    private static buildLetter(buckets: Record<Bucket, string[]>): string {
        // Пока источник один (Ozon), суффикс у всех строк одинаковый. Берётся он не
        // константой, а через donorSuffixFor: ВБ-счёт озоновской пометкой помечать нельзя,
        // донорский SQL покупателя не различает, и партия уехала бы в чужой пул.
        const donorMark = donorSuffixFor('OZON').trim();
        return [
            'По этим счетам стоит пометка « отмена» («товар у нас»), а маркетплейс завёл запись возврата.',
            'Разделы ниже отличаются тем, ЧТО делать, — они не взаимозаменяемы.',
            '',
            ...(buckets.arrived.length
                ? [
                      'ДОЕХАЛО ДО СКЛАДА МАРКЕТПЛЕЙСА — пора исправлять:',
                      `  1) заменить пометку в примечании счёта на «${donorMark}» —`,
                      '     без неё FBO-продажа не увидит счёт донором и спишет остаток с полки, которого нет;',
                      '  2) счёт НЕ расформировывать: подборка из него уйдёт на FBO-продажу;',
                      '  3) если на счёте есть коды маркировки — вернуть их в состояние «передан маркету».',
                      '',
                      ...buckets.arrived,
                      '',
                  ]
                : []),
            ...(buckets.inTransit.length
                ? [
                      'ЕЩЁ В ПУТИ — пометку НЕ менять, пока не доедет:',
                      '  пока товара нет на складе маркетплейса, продавать оттуда нечего, и ранняя',
                      `  «${donorMark}» отдала бы партию FBO-продаже под товар в дороге.`,
                      '  Сейчас нужно одно: НЕ расформировывать счёт — коробки у нас нет.',
                      '  Возвраты, едущие К НАМ, сюда не попадают вовсе — для них пометка « отмена» верна.',
                      '  Но по раннему состоянию направление не всегда определено: сверьтесь с маршрутом в строке.',
                      '',
                      ...buckets.inTransit,
                      '',
                  ]
                : []),
            ...(buckets.dismantled.length
                ? [
                      'СЧЁТ УЖЕ РАСФОРМИРОВАН, А ТОВАР У МАРКЕТПЛЕЙСА — фантомный остаток:',
                      '  товар разложили по полкам, хотя коробки у нас нет. На полке его не найдут,',
                      '  а на складе маркетплейса он есть и продастся оттуда. Донором такой счёт уже',
                      '  не станет — разбирать руками: снять полочный остаток и решить по кодам.',
                      '',
                      ...buckets.dismantled,
                      '',
                  ]
                : []),
            ...(buckets.lost.length
                ? [
                      'ТОВАР НЕ ДОЕДЕТ — списан, утилизирован или потерян у маркетплейса:',
                      '  ждать нечего и пометку менять не на что: донором такой счёт не станет,',
                      '  товара не будет ни у нас, ни на складе маркетплейса. Разобрать руками:',
                      '  счёт закрыть или расформировать, потерю провести отдельно.',
                      '',
                      ...buckets.lost,
                  ]
                : []),
        ].join('\n');
    }
}
