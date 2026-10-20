import { Logger } from '@nestjs/common';
import { LogPriceReportsCommand } from './log-price-reports.command';
import { GoodServiceEnum } from '../../good/good.service.enum';

describe('LogPriceReportsCommand (журнал цен по товару)', () => {
    const input = {
        offer_id: '564323',
        incoming_price: 1234.567,
        available_price: 0,
        min_perc: 20,
        perc: 40,
        old_perc: 80,
        adv_perc: 0,
        sum_pack: 10,
        sales_percent: 38,
        fbs_direct_flow_trans_max_amount: 76,
    };
    const sent = { offer_id: '564323', price: '3359', old_price: '6718', min_price: '1680' } as any;
    let log: jest.SpyInstance;
    let warn: jest.SpyInstance;

    beforeEach(() => {
        log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('что взяли, что отправили, что ответил Озон; отказ — предупреждением; пропуск — с причиной', async () => {
        const ctx = {
            skus: [],
            priceReports: [
                {
                    service: GoodServiceEnum.OZON,
                    coeffs: { minMil: 76, percMil: 5, percEkv: 1.5, sumObtain: 25, sumLabel: 0, taxUnit: 6 },
                    inputs: [input],
                    sent: [sent],
                    skipped: [{ offer_id: '557502', reason: 'no-free-stock' as const }],
                    response: {
                        result: [{ offer_id: '564323', updated: false, errors: [{ code: 'E', message: 'нет' }] }],
                    },
                },
            ],
        };
        await expect(new LogPriceReportsCommand().execute(ctx)).resolves.toBe(ctx);
        expect(warn).toHaveBeenCalledWith(
            '[цены ozon] 564323: вх 1234.57, наценки мин/норм/макс 20/40/80, реклама 0, упаковка 10, комиссия 38%, ' +
                'логистика до 76 → отправили 3359/6718/1680 (цена/до скидки/мин) → Озон: отказ: E нет',
        );
        expect(log).toHaveBeenCalledWith(expect.stringContaining('[цены ozon] коэффициенты: мин.логистика 76'));
        expect(log).toHaveBeenCalledWith(
            '[цены ozon] 557502: цену не считали — нет свободного остатка (всё в резерве или распродано)',
        );
    });

    it('принятое Озоном — обычной строкой', async () => {
        await new LogPriceReportsCommand().execute({
            skus: [],
            priceReports: [
                {
                    service: GoodServiceEnum.OZON,
                    inputs: [input],
                    sent: [sent],
                    skipped: [],
                    response: { result: [{ offer_id: '564323', updated: true, errors: [] }] },
                },
            ],
        });
        expect(warn).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('→ Озон: принят'));
    });
});
