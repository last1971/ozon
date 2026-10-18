import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProfitCheckService } from './profit-check.service';
import { SalePriceSources } from './sale-price.sources';
import { LoadPendingCommand } from './commands/load-pending.command';
import { ResolveSalePricesCommand } from './commands/resolve-sale-prices.command';
import { LoadPriceContextCommand } from './commands/load-price-context.command';
import { EvaluateCommand } from './commands/evaluate.command';
import { NotifyCommand } from './commands/notify.command';
import { MarkHandledCommand } from './commands/mark-handled.command';
import { MpEventService } from '../../mp-event/mp-event.service';
import { ExtraPriceService } from '../../price/extra.price.service';
import { GOOD_SERVICE } from '../../interfaces/IGood';
import { PostingService } from '../../posting/posting.service';
import { WbOrderService } from '../../wb.order/wb.order.service';
import { YandexOrderService } from '../../yandex.order/yandex.order.service';

const hdr = {
    offer_id: '568615',
    incoming_price: 832.25,
    available_price: 0,
    fbs_direct_flow_trans_max_amount: 80,
    sales_percent: 28,
    min_perc: 7,
    perc: 20,
    old_perc: 50,
    adv_perc: 1,
    sum_pack: 8,
};
const coeffs = { minMil: 0, percMil: 0, percEkv: 0, sumObtain: 30, sumLabel: 4, taxUnit: 0 };
const t = { id: 'tx' } as any;

describe('ProfitCheckService', () => {
    const journal = {
        record: jest.fn().mockResolvedValue(true),
        listUnhandledRows: jest.fn().mockResolvedValue([]),
        markHandled: jest.fn(),
    };
    const priceService = { getObtainCoeffs: () => coeffs };
    const prices = { getService: jest.fn().mockReturnValue(priceService) };
    const goods = { buildPriceables: jest.fn().mockResolvedValue([hdr]) };
    const ozon = { getBuyerId: jest.fn(() => 24231), salePriceSource: () => 'posting', lookupSalePrices: jest.fn() };
    const wb = {
        getBuyerId: jest.fn(() => 24243),
        salePriceSource: () => 'lookup',
        lookupSalePrices: jest.fn().mockResolvedValue(new Map()),
    };
    const yandex = { getBuyerId: jest.fn(() => 24465), salePriceSource: () => 'none', lookupSalePrices: jest.fn() };
    const config = {
        get: jest.fn(
            (k: string, d?: any) => ({ OZON_BUYER_ID: 24231, WB_BUYER_ID: 24243, YANDEX_BUYER_ID: 24465 })[k] ?? d,
        ),
    };
    const emitter = { emit: jest.fn() };
    let service: ProfitCheckService;

    beforeEach(async () => {
        jest.clearAllMocks();
        // Через контейнер Nest: ловит и неразрешимые зависимости (как FIREBIRD у DonorPiecesStore 16.10).
        const module = await Test.createTestingModule({
            providers: [
                ProfitCheckService,
                SalePriceSources,
                LoadPendingCommand,
                ResolveSalePricesCommand,
                LoadPriceContextCommand,
                EvaluateCommand,
                NotifyCommand,
                MarkHandledCommand,
                { provide: MpEventService, useValue: journal },
                { provide: ExtraPriceService, useValue: prices },
                { provide: GOOD_SERVICE, useValue: goods },
                { provide: ConfigService, useValue: config },
                { provide: EventEmitter2, useValue: emitter },
                { provide: PostingService, useValue: ozon },
                { provide: WbOrderService, useValue: wb },
                { provide: YandexOrderService, useValue: yandex },
            ],
        }).compile();
        service = module.get(ProfitCheckService);
    });

    const posting = (over: any = {}) => ({
        posting_number: 'P-1',
        status: 's',
        in_process_at: '2026-10-17',
        products: [{ offer_id: '568615', quantity: 1, price: '1197.11' }],
        ...over,
    });
    const invoice = { id: 97978, number: 21016, status: 3 } as any;

    describe('хук создания счёта', () => {
        it('Озон: в очередь с нашими ценами из заказа, той же транзакцией', async () => {
            await service.enqueue({ buyerId: 24231, posting: posting(), invoice, transaction: t });
            expect(journal.record).toHaveBeenCalledTimes(1);
            const [event, tx] = journal.record.mock.calls[0];
            expect(tx).toBe(t);
            expect(event).toMatchObject({
                service: 'OZON',
                kind: 'PROFIT_CHECK',
                extId: 'P-1',
                state: 'pending',
                posting: '21016',
            });
            expect(event.payload).toMatchObject({
                priceSource: 'posting',
                scode: 97978,
                externalId: 'P-1',
                lines: [{ offer_id: '568615', units: 1, pricePerUnit: 1197.11 }],
            });
        });

        it('ВБ: источник lookup, внешний id = rid заказа', async () => {
            await service.enqueue({
                buyerId: 24243,
                posting: posting({ service: 'wb', external_id: 'ecb.r92.0.0' }),
                invoice,
                transaction: null,
            });
            expect(journal.record.mock.calls[0][0].payload).toMatchObject({
                service: 'WB',
                priceSource: 'lookup',
                externalId: 'ecb.r92.0.0',
            });
        });

        it('розница: покупатель Озона без OZON_BUYER_ID в env (дефолт 24416) — площадку называет сам Озон', async () => {
            ozon.getBuyerId.mockReturnValueOnce(24416);
            await service.enqueue({ buyerId: 24416, posting: posting(), invoice, transaction: t });
            expect(journal.record).toHaveBeenCalledTimes(1);
            expect(journal.record.mock.calls[0][0]).toMatchObject({ service: 'OZON', extId: 'P-1' });
        });

        it('Яндекс (none) и неизвестный покупатель — в очередь не попадают; сбой журнала счёт не роняет', async () => {
            await service.enqueue({ buyerId: 24465, posting: posting(), invoice, transaction: t });
            await service.enqueue({ buyerId: 1, posting: posting(), invoice, transaction: t });
            expect(journal.record).not.toHaveBeenCalled();
            journal.record.mockRejectedValueOnce(new Error('база'));
            await expect(
                service.enqueue({ buyerId: 24231, posting: posting(), invoice, transaction: t }),
            ).resolves.toBeUndefined();
        });
    });

    describe('проход', () => {
        const row = (over: any = {}) => ({
            extId: 'P-1',
            state: 'pending',
            posting: '21016',
            firstSeen: new Date(),
            payload: {
                service: 'OZON',
                buyerId: 24231,
                scode: 97978,
                invoiceNumber: 21016,
                externalId: 'P-1',
                priceSource: 'posting',
                lines: [{ offer_id: '568615', units: 1, pricePerUnit: 1197.11 }],
            },
            ...over,
        });

        it('Озон без прибыли → тревога с пушем, запись обработана, данные расчёта через единый сборщик', async () => {
            journal.listUnhandledRows.mockImplementation(async (s: string) => (s === 'OZON' ? [row()] : []));
            await service.run();
            expect(goods.buildPriceables).toHaveBeenCalledWith(priceService, ['568615']);
            expect(emitter.emit).toHaveBeenCalledTimes(1);
            const [name, items] = emitter.emit.mock.calls[0];
            expect(name).toBe('profit.check');
            expect(items[0].level).toBe('alert');
            expect(items[0].verdicts[0].profitPerUnit).toBeLessThan(0);
            expect(journal.markHandled).toHaveBeenCalledWith(
                expect.objectContaining({ service: 'OZON', kind: 'PROFIT_CHECK', extId: 'P-1', state: 'pending' }),
                undefined,
            );
        });

        it('норма → сообщения нет, запись обработана', async () => {
            journal.listUnhandledRows.mockImplementation(async (s: string) =>
                s === 'OZON'
                    ? [
                          row({
                              payload: {
                                  ...row().payload,
                                  lines: [{ offer_id: '568615', units: 1, pricePerUnit: 1837 }],
                              },
                          }),
                      ]
                    : [],
            );
            await service.run();
            expect(emitter.emit).not.toHaveBeenCalled();
            expect(journal.markHandled).toHaveBeenCalledTimes(1);
        });

        it('ВБ: цены в статистике ещё нет → остаётся в очереди; есть → считается по ней', async () => {
            const wbRow = row({
                payload: {
                    ...row().payload,
                    service: 'WB',
                    priceSource: 'lookup',
                    externalId: 'ecb.r92.0.0',
                    lines: [{ offer_id: '568615', units: 1, pricePerUnit: 922 }],
                },
            });
            journal.listUnhandledRows.mockImplementation(async (s: string) => (s === 'WB' ? [wbRow] : []));
            await service.run();
            expect(journal.markHandled).not.toHaveBeenCalled();
            expect(emitter.emit).not.toHaveBeenCalled();

            wb.lookupSalePrices.mockResolvedValueOnce(
                new Map([['ecb.r92.0.0', [{ offer_id: '568615', units: 1, pricePerUnit: 1837 }]]]),
            );
            await service.run();
            expect(journal.markHandled).toHaveBeenCalledTimes(1);
            expect(emitter.emit).not.toHaveBeenCalled();
        });

        it('ВБ: цены нет дольше срока ожидания → «не проверено» и обработано', async () => {
            const old = row({
                firstSeen: new Date(Date.now() - 4 * 3600_000),
                payload: { ...row().payload, service: 'WB', priceSource: 'lookup', externalId: 'ecb.x' },
            });
            journal.listUnhandledRows.mockImplementation(async (s: string) => (s === 'WB' ? [old] : []));
            await service.run();
            expect(journal.markHandled).toHaveBeenCalledTimes(1);
            const items = emitter.emit.mock.calls[0][1];
            expect(items[0].level).toBe('skip');
            expect(items[0].reason).toContain('за 3 ч');
        });

        it('площадка выключена на узле → не проверено', async () => {
            prices.getService.mockReturnValueOnce(null);
            journal.listUnhandledRows.mockImplementation(async (s: string) => (s === 'OZON' ? [row()] : []));
            await service.run();
            expect(emitter.emit.mock.calls[0][1][0]).toMatchObject({
                level: 'skip',
                reason: 'площадка выключена на этом узле',
            });
        });
    });
});
