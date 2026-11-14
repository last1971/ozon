import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { JobService } from '../../src/job/job.service';
import { calculatePrice } from '../../src/helpers/price/price.helpers';
import { UpdatePriceDto } from '../../src/price/dto/update.price.dto';
import { PromoPriceService } from '../../src/promos/price-lever/promo-price.service';
import { PromoPriceApplier } from '../../src/promos/price-lever/promo-price.applier';
import { PromoSweepService } from '../../src/promos/price-lever/sweep/promo-sweep.service';
import { CollectSweepCommand } from '../../src/promos/price-lever/sweep/collect-sweep.command';
import { PlanSweepCommand } from '../../src/promos/price-lever/sweep/plan-sweep.command';
import { ApplySweepCommand } from '../../src/promos/price-lever/sweep/apply-sweep.command';
import { BuildSweepReportCommand } from '../../src/promos/price-lever/sweep/build-sweep-report.command';
import { NotifySweepCommand } from '../../src/promos/price-lever/sweep/notify-sweep.command';
import { EnrichWithPricingCommand } from '../../src/promos/price-lever/sweep/enrich-with-pricing.command';
import { OzonLossPriceAdapter } from '../../src/marketplace-loss/prices/ozon-loss-price.adapter';
import { MarketPriceWorkflowService } from '../../src/marketplace-loss/prices/market-price-workflow.service';
import { CheckLossPriceStockCommand } from '../../src/marketplace-loss/prices/check-loss-price-stock.command';
import {
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
} from '../../src/marketplace-loss/prices/loss-price.commands';

import { ozonPricesMatch } from '../../src/helpers/price/ozon-prices-match';
import { ExtraPriceService } from '../../src/price/extra.price.service';
import { ExtraGoodService } from '../../src/good/extra.good.service';
import { GoodServiceEnum } from '../../src/good/good.service.enum';
import { IncomingPricesCommand } from '../../src/price/commands/incoming-prices.command';
import { ValidateSkusNotEmptyCommand } from '../../src/price/commands/validate-skus-not-empty.command';
import { TradeSkusCommand } from '../../src/price/commands/trade-skus.command';
import { ResetAvailablePriceCommand } from '../../src/price/commands/reset-available-price.command';
import { SetResultProcessingMessageCommand } from '../../src/price/commands/set-result-processing-message.command';
import { LogResultProcessingMessageCommand } from '../../src/price/commands/log-result-processing-message.command';
import { Trade2006IncomingService } from '../../src/trade2006.incoming/trade2006.incoming.service';
import { LoadPendingIncomingCommand } from '../../src/trade2006.incoming/commands/load-pending-incoming.command';
import { LoadIncomingGoodsCommand } from '../../src/trade2006.incoming/commands/load-incoming-goods.command';
import { RepriceIncomingGoodsCommand } from '../../src/trade2006.incoming/commands/reprice-incoming-goods.command';
import { MarkIncomingHandledCommand } from '../../src/trade2006.incoming/commands/mark-incoming-handled.command';

/** Только внешнее состояние: переживает создание новых сервисов и сериализацию JSON. */
export interface OzonIncomingFixtureState {
    cost: number;
    live: { price: number; old_price: number; min_price: number; marketing_seller_price: number };
    actionPrice: number;
    sellerPercent: number;
    receipt: { extId: string; version: string; payload: Record<string, unknown>; handled: boolean };
    requests: { kind: 'price' | 'action' | 'percent'; body: unknown }[];
    notifications: { event: string; report: unknown }[];
}

/** Реальные команды прихода, Ozon-адаптер, планировщик, исполнитель акций и уведомление.
 * Подменены только внешние API и чтение исходных данных; сеть и база не используются. */
export function setup(saved?: OzonIncomingFixtureState, options: { legacyComparison?: boolean } = {}) {
    Logger.overrideLogger(false);
    const data: OzonIncomingFixtureState = saved
        ? structuredClone(saved)
        : {
              cost: 100,
              live: { price: 150, old_price: 200, min_price: 100, marketing_seller_price: 143 },
              actionPrice: 150,
              sellerPercent: 5,
              receipt: { extId: '50013', version: 'v1', payload: {}, handled: false },
              requests: [],
              notifications: [],
          };
    const offer = '535776';
    let acknowledgeOnly = false;
    // Контролируемые входы настоящей формулы Ozon дают числа инцидента: 699 / 279 / 837.
    const flat = { min: 0, max: null, minIncluded: true, maxIncluded: false };
    const ozon = {
        schemes: [
            {
                scheme: 'fbs' as const,
                commissions: [{ ...flat, rate: 0 }],
                logistics: [{ ...flat, amount: 0 }],
                firstMile: 0,
                lastMile: 0,
            },
        ],
        acquiringRate: 0,
        minProfitRub: 0,
        minMarkupPercent: 0,
        vatRate: 0,
        profitTaxRate: 0,
    };
    const input = () => ({
        offer_id: offer,
        incoming_price: data.cost,
        available_price: 0,
        min_perc: 179,
        perc: 599,
        old_perc: 737,
        adv_perc: 0,
        sum_pack: 0,
        sales_percent: 0,
        fbs_direct_flow_trans_max_amount: 0,
        ozon,
    });
    const coeffs = { minMil: 0, percMil: 0, percEkv: 0, sumObtain: 0, sumLabel: 0, taxUnit: 0 };
    const target = () => calculatePrice(input(), coeffs);
    const live = data.live;
    const updateBuyer = () => {
        live.marketing_seller_price = Math.round(
            Math.min(live.price, data.actionPrice) * (1 - data.sellerPercent / 100),
        );
    };
    const products = {
        getPrices: jest.fn(async () => ({
            items: [
                {
                    offer_id: offer,
                    product_id: 1,
                    price: { ...live },
                    marketing_actions: {
                        actions: [
                            { title: 'Бустинг', value: data.actionPrice, date_from: '', date_to: '' },
                            { title: '26-11', value: data.sellerPercent, date_from: '', date_to: '' },
                        ],
                    },
                },
            ],
        })),
        infoList: jest.fn(async (offers: string[]) => offers.map((sku) => ({ sku, fboCount: 1 }))),
        listAllOfferIds: jest.fn(async () => [offer]),
    };
    const pricing = {
        getObtainCoeffs: () => coeffs,
        getPricingAvailability: async () => new Map([[offer, { state: 'available', marketplace: 1 }]]),
        updatePrices: jest.fn(async (targets: UpdatePriceDto[]) => {
            data.requests.push({ kind: 'price', body: structuredClone(targets) });
            // Поведение /import/prices в сохранённом инциденте: normal сбрасывает акционную price.
            for (const row of targets) {
                Object.assign(live, {
                    price: Number(row.price),
                    min_price: Number(row.min_price),
                    old_price: Number(row.old_price),
                });
                data.actionPrice = live.price;
                updateBuyer();
            }
            return { result: targets.map((row) => ({ offer_id: row.offer_id, updated: true })) };
        }),
    };
    const actionProduct = () => ({
        id: 1,
        actionPrice: data.actionPrice,
        maxActionPrice: 2000,
        stock: 1,
        participant: true,
    });
    const api = {
        listActions: jest.fn(async () => [{ id: 1, title: 'Бустинг', is_voucher_action: false }]),
        listAll: jest.fn(async (kind: string) => (kind === 'products' ? [actionProduct()] : [])),
        currentProduct: jest.fn(async () => actionProduct()),
        update: jest.fn(async (_id: number, rows: { actionPrice: number }[]) => {
            data.requests.push({ kind: 'action', body: structuredClone(rows) });
            if (!acknowledgeOnly) {
                data.actionPrice = rows[0].actionPrice;
                live.price = data.actionPrice;
                updateBuyer();
            }
            return { added: [1], unchanged: [], rejected: [], removed: [], warnings: [] };
        }),
    };
    const sellerApi = {
        activeAction: jest.fn(async () => ({ id: 2, title: '26-11', minPercent: 5 })),
        listAll: jest.fn(async (kind: string) =>
            kind === 'list' ? [{ productId: 1, sku: 1, percent: data.sellerPercent, isActive: true }] : [],
        ),
        setPercent: jest.fn(async (_id: number, rows: { percent: number }[]) => {
            data.requests.push({ kind: 'percent', body: structuredClone(rows) });
            data.sellerPercent = rows[0].percent;
            updateBuyer();
            return { applied: [1], rejected: [] };
        }),
    };
    const goods = {
        buildPriceables: jest.fn(async () => [input()]),
        resetAvailablePrice: jest.fn(async () => {}),
        in: jest.fn(async () => [{ code: Number(offer), quantity: 10, reserve: 0 }]),
        prices: jest.fn(async () => [
            { code: Number(offer), price: data.cost, free_stock: 10, base_source: 'remaining-lots' },
        ]),
        getPerc: jest.fn(async () => [{ ...input(), pieces: 1, packing_price: 0 }]),
    };
    const events = {
        emit: jest.fn((event: string, report: unknown) => {
            data.notifications.push({ event, report: structuredClone(report) });
        }),
    };
    const journal = {
        listUnhandledRows: jest.fn(async () =>
            data.receipt.handled ? [] : [{ ...data.receipt, firstSeen: new Date('2026-11-14T10:00:00Z') }],
        ),
        isCurrentVersion: jest.fn(
            async (event: { extId: string }, version: string) =>
                !data.receipt.handled && event.extId === data.receipt.extId && version === data.receipt.version,
        ),
        finishVersion: jest.fn(
            async (event: { extId: string }, version: string, payload: Record<string, unknown>, handled: boolean) => {
                if (event.extId !== data.receipt.extId || version !== data.receipt.version) return false;
                Object.assign(data.receipt, { payload: structuredClone(payload), handled });
                return true;
            },
        ),
    };
    const catalog = Object.create(ExtraGoodService.prototype);
    catalog.getCountUpdateableService = () => ({ skuList: [offer] });
    catalog.whenSkuListsReady = async () => {};
    // Точный триггер инцидента: Ozon работает, ошибка списка SKU ВБ удерживает весь приход.
    catalog.isSkuListAvailable = (service: GoodServiceEnum) => service !== GoodServiceEnum.WB;
    const config = new ConfigService({
        PRICE_VERIFY_DELAY_MS: 0,
        SUM_LABEL: 0,
        SUM_OBTAIN: 0,
        SUM_PACK: 0,
        TAX_UNIT: 0,
    });
    function restart() {
        const jobs = new JobService();
        const applier = new PromoPriceApplier(api as any, sellerApi as any, {} as any, products as any);
        const promoPrices = new PromoPriceService(api as any, sellerApi as any, products as any, applier);
        const enrich = new EnrichWithPricingCommand(
            { prepare: async () => {}, load: async () => ozon } as any,
            products as any,
            goods as any,
            config,
        );
        const sweep = new PromoSweepService(
            jobs,
            new CollectSweepCommand(promoPrices),
            enrich,
            new PlanSweepCommand(),
            new ApplySweepCommand(applier),
            new BuildSweepReportCommand(),
            new NotifySweepCommand(events as any),
        );
        const adapter = new OzonLossPriceAdapter(pricing as any, products as any, sweep, jobs, promoPrices);
        if (options.legacyComparison) {
            // Точная реализация matches до исправления (HEAD 09c0dd6). Только отрицательный контроль теста.
            adapter.matches = (target, actual) => ozonPricesMatch(target, actual, 0);
        }
        const workflow = new MarketPriceWorkflowService(
            jobs,
            { OZON: adapter, WB: {} as any },
            new CalculateLossPriceTargetsCommand(goods as any),
            new CompareLossPricesCommand(),
            new SendLossPricesCommand(),
            new ConfirmLossPricesCommand(config),
            new CheckLossPricePromosCommand(),
            new CheckLossPriceStockCommand(),
        );
        const extra = Object.assign(Object.create(ExtraPriceService.prototype), {
            services: new Map<GoodServiceEnum, unknown>([
                [GoodServiceEnum.OZON, pricing],
                [GoodServiceEnum.WB, {}],
            ]),
            logger: { log: jest.fn(), error: jest.fn() },
            validateSkusNotEmptyCommand: new ValidateSkusNotEmptyCommand(),
            tradeSkusCommand: new TradeSkusCommand(catalog),
            resetAvailablePriceCommand: new ResetAvailablePriceCommand(goods as any),
            setResultProcessingMessageCommand: new SetResultProcessingMessageCommand(),
            logResultProcessingMessageCommand: new LogResultProcessingMessageCommand(),
        });
        extra.incomingPricesCommand = new IncomingPricesCommand(extra, catalog, workflow);
        const incoming = new Trade2006IncomingService(
            config,
            new LoadPendingIncomingCommand(journal as any),
            new LoadIncomingGoodsCommand({
                goodsByPrihod: async () => new Map([[data.receipt.extId, [offer]]]),
            } as any),
            new RepriceIncomingGoodsCommand(extra, journal as any),
            new MarkIncomingHandledCommand(journal as any),
        );
        return {
            adapter,
            run: () => workflow.incoming('OZON', [offer], async () => {}),
            runInvoice: () => incoming.run(),
        };
    }
    return {
        ...restart(),
        data,
        journal,
        restart,
        offer,
        live,
        target,
        pricing,
        api,
        events,
        goods,
        setCost: (next: number) => {
            data.cost = next;
        },
        setAcknowledgementOnly: (on: boolean) => {
            acknowledgeOnly = on;
        },
    };
}
