import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { GoodServiceEnum } from '../good/good.service.enum';
import {
    ARRIVALS_WINDOW_DAYS,
    buildArrivalsList,
    buildDealsList,
    buildHitsList,
    buildNewList,
    ShowcaseDealPrice,
    DEFAULT_NOT_ARRIVAL_SUPPLIERS,
    NEW_WINDOW_DAYS,
    parseSupplierCodes,
    ShowcaseList,
    showcaseSince,
} from '../helpers/showcase/showcase.lists';

/** Все списки витрин в порядке отправки. */
export const SHOWCASE_LISTS: ShowcaseList[] = ['new', 'hits', 'arrivals', 'deals'];
/** Что считается по Trade и уходит по крону; deals — только с ценами. */
const TRADE_LISTS: ShowcaseList[] = ['new', 'hits', 'arrivals'];
import { SyliusApiService } from '../sylius/sylius.api.service';
import { Trade2006ShowcaseService } from '../trade2006.showcase/trade2006.showcase.service';

/** Итог по одному списку. codes — сами коды (только в пробном режиме), count — сколько. */
export interface ShowcaseListResult {
    list: ShowcaseList;
    count: number;
    codes?: string[];
    received?: number;
    notFound?: number;
    error?: string;
}

export interface ShowcaseRunResult {
    dryRun: boolean;
    /** Почему не считали (Sylius на этой установке не подключён). */
    skipped?: string;
    lists: ShowcaseListResult[];
    /** Когда посчитан список deals, который ручка переотправляет (полная отправка цен; до рестарта процесса). */
    dealsComputedAt: string | null;
}

/**
 * Витрины сайта electronica.su: «Новинки» (первый приход за 180 дней), «Хиты» (продажи за 90 дней) и «Свежие
 * поступления» (приходы от поставщика за 30 дней) по данным Trade раз в 30 минут и по ручке; «Лучшие предложения» —
 * из цен, которые только что ушли в Sylius (sendDeals зовёт SyliusPriceService в конце полной отправки цен).
 * Ручка может переотправить deals из последнего такого расчёта — второй расчёт цен не делаем.
 * Отправка — тем же клиентом и токеном, что цены (201 — успех, 422 — ошибка запроса, 401 — клиент сам обновит токен).
 * Каждый список заменяется на сайте целиком.
 */
@Injectable()
export class SyliusShowcaseService {
    static readonly URL = '/api/v2/admin/showcase/update';
    private readonly logger = new Logger(SyliusShowcaseService.name);
    /** Последний посчитанный deals — для ручной переотправки. */
    private lastDeals: { codes: string[]; at: string } | null = null;
    /** Поставщики-«не приходы» (возвраты, пересортица) — из env, по умолчанию решение владельца 20.10.2026. */
    private readonly notArrivalSuppliers: number[];

    constructor(
        private readonly config: ConfigService,
        private readonly trade: Trade2006ShowcaseService,
        private readonly api: SyliusApiService,
    ) {
        this.notArrivalSuppliers = parseSupplierCodes(
            this.config.get<string>('SHOWCASE_NOT_ARRIVAL_SUPPLIERS', DEFAULT_NOT_ARRIVAL_SUPPLIERS) ??
                DEFAULT_NOT_ARRIVAL_SUPPLIERS,
        );
    }

    /** Sylius подключён на этой установке — то же правило, что у цен (SERVICES содержит sylius). */
    enabled(): boolean {
        return (this.config.get<GoodServiceEnum[]>('SERVICES', []) ?? []).includes(GoodServiceEnum.SYLIUS);
    }

    @Cron('0 */30 * * * *', { name: 'syliusShowcase' })
    async scheduled(): Promise<void> {
        if (!this.enabled()) return;
        try {
            await this.run(false, TRADE_LISTS);
        } catch (e) {
            this.logger.error(`витрины Sylius: ${(e as Error).message}`);
        }
    }

    /** Разбор ?list=new,hits из ручки; пусто — все. Неизвестный список — 400. */
    static parseLists(raw?: string): ShowcaseList[] {
        const wanted = String(raw ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
        if (!wanted.length) return [...SHOWCASE_LISTS];
        const unknown = wanted.filter((l) => !SHOWCASE_LISTS.includes(l as ShowcaseList));
        if (unknown.length) {
            throw new BadRequestException(`неизвестный список: ${unknown.join(', ')} (${SHOWCASE_LISTS.join(', ')})`);
        }
        return SHOWCASE_LISTS.filter((l) => wanted.includes(l));
    }

    /**
     * Посчитать и (не dryRun) отправить выбранные списки, по одному за вызов. new и hits считаются здесь,
     * deals — последний расчёт с полной отправки цен; его ещё нет (рестарт) — ошибка с подсказкой, что запустить.
     */
    async run(dryRun: boolean, lists: ShowcaseList[] = SHOWCASE_LISTS, now = new Date()): Promise<ShowcaseRunResult> {
        const dealsComputedAt = this.lastDeals?.at ?? null;
        if (!this.enabled()) {
            return { dryRun, skipped: 'Sylius не подключён (SERVICES без sylius)', lists: [], dealsComputedAt };
        }
        const built = new Map<ShowcaseList, string[]>();
        if (lists.some((l) => TRADE_LISTS.includes(l))) {
            const newSince = showcaseSince(now, NEW_WINDOW_DAYS);
            const hitsSince = showcaseSince(now);
            const arrivalsSince = showcaseSince(now, ARRIVALS_WINDOW_DAYS);
            const [stock, firstIn, sales, supplied] = await Promise.all([
                this.trade.inShopStock(),
                lists.includes('new') ? this.trade.firstShopArrivals(newSince) : Promise.resolve([]),
                lists.includes('hits') ? this.trade.sales(hitsSince) : Promise.resolve([]),
                lists.includes('arrivals')
                    ? this.trade.lastSupplierArrivals(arrivalsSince, this.notArrivalSuppliers)
                    : Promise.resolve([]),
            ]);
            if (lists.includes('new')) built.set('new', buildNewList(firstIn, stock, newSince));
            if (lists.includes('hits')) built.set('hits', buildHitsList(sales, stock));
            if (lists.includes('arrivals')) built.set('arrivals', buildArrivalsList(supplied, stock, arrivalsSince));
        }
        if (lists.includes('deals') && this.lastDeals) built.set('deals', this.lastDeals.codes);

        const results: ShowcaseListResult[] = [];
        for (const list of lists) {
            const codes = built.get(list);
            if (!codes) {
                results.push({
                    list,
                    count: 0,
                    error: 'ещё не посчитан: deals считается при полной отправке цен (POST /api/price/all/sylius)',
                });
                continue;
            }
            results.push(dryRun ? { list, count: codes.length, codes } : await this.send(list, codes));
        }
        return { dryRun, lists: results, dealsComputedAt };
    }

    /**
     * deals из цен, ушедших в Sylius за полную отправку. Пустой набор не отправляем: это сбой отправки цен,
     * а не «скидок нет» — иначе список на сайте сотрётся.
     */
    async sendDeals(prices: ShowcaseDealPrice[]): Promise<ShowcaseListResult | null> {
        if (!this.enabled()) return null;
        if (!prices.length) {
            this.logger.warn('витрины Sylius: deals — цены не ушли, список не трогаем');
            return null;
        }
        const codes = buildDealsList(prices, await this.trade.inShopStock());
        this.lastDeals = { codes, at: new Date().toISOString() };
        return this.send('deals', codes);
    }

    private async send(list: ShowcaseList, codes: string[]): Promise<ShowcaseListResult> {
        try {
            const res = await this.api.method<{ list: string; received: number; notFound: number }>(
                SyliusShowcaseService.URL,
                'post',
                { list, codes },
            );
            this.logger.log(
                `витрины Sylius: ${list} — отправлено ${codes.length}, принято ${res?.received}, нет на сайте ${res?.notFound}`,
            );
            return { list, count: codes.length, received: res?.received, notFound: res?.notFound };
        } catch (e) {
            const message = SyliusShowcaseService.errorText(e);
            this.logger.error(`витрины Sylius: ${list} не отправлен — ${message}`);
            return { list, count: codes.length, error: message };
        }
    }

    /** 422 и прочие ответы сайта — со статусом и текстом сайта, а не «Request failed with status code». */
    private static errorText(e: unknown): string {
        const res = (e as AxiosError)?.response;
        if (!res) return (e as Error)?.message ?? String(e);
        const data = res.data as { message?: string; detail?: string } | string | undefined;
        const text = typeof data === 'string' ? data : data?.detail || data?.message || JSON.stringify(data ?? '');
        return `${res.status}: ${text}`;
    }
}
