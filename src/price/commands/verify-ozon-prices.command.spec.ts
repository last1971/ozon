import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VerifyOzonPricesCommand } from './verify-ozon-prices.command';
import { ExtraPriceService } from '../extra.price.service';
import { ProductService } from '../../product/product.service';
import { GoodServiceEnum } from '../../good/good.service.enum';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';

describe('VerifyOzonPricesCommand (сверка после отправки цен)', () => {
    const sent = [
        { offer_id: '564323', price: '3359', old_price: '6718', min_price: '1680' },
        { offer_id: '551444', price: '900', old_price: '1800', min_price: '450' },
    ] as any[];
    const onOzon = (rows: Record<string, [number, number, number]>) => ({
        items: Object.entries(rows).map(([offer_id, [price, old_price, min_price]]) => ({
            offer_id,
            price: { price, old_price, min_price },
        })),
    });
    const ctx = (response: any = { result: [] }): IGoodsProcessingContext => ({
        skus: [],
        priceReports: [{ service: GoodServiceEnum.OZON, inputs: [], sent, skipped: [], response }],
    });

    let getPrices: jest.Mock;
    let updatePrices: jest.Mock;
    let emit: jest.Mock;
    let command: VerifyOzonPricesCommand;

    beforeEach(() => {
        getPrices = jest.fn();
        updatePrices = jest.fn().mockResolvedValue({ result: [{ offer_id: '551444', updated: true, errors: [] }] });
        emit = jest.fn();
        command = new VerifyOzonPricesCommand(
            { getService: () => ({ updatePrices }) } as any,
            { getPrices } as any,
            { get: (k: string, d: any) => (k === 'PRICE_VERIFY_DELAY_MS' ? 0 : d) } as any,
            { emit } as any,
        );
    });

    it('всё встало (копейки не в счёт) — повтора и письма нет', async () => {
        getPrices.mockResolvedValueOnce(onOzon({ '564323': [3359, 6718, 1680], '551444': [900.4, 1800, 450] }));
        await command.execute(ctx());
        expect(getPrices).toHaveBeenCalledWith(expect.objectContaining({ offer_id: ['564323', '551444'], limit: 2 }));
        expect(updatePrices).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('не встало — повтор только расхождений; со второго раза встало — письма нет', async () => {
        getPrices
            .mockResolvedValueOnce(onOzon({ '564323': [3359, 6718, 1680], '551444': [1200, 2400, 600] }))
            .mockResolvedValueOnce(onOzon({ '551444': [900, 1800, 450] }));
        await command.execute(ctx());
        expect(updatePrices).toHaveBeenCalledWith([sent[1]]);
        expect(emit).not.toHaveBeenCalled();
    });

    it('не встало и после повтора — письмо в «цены»: что посчитали, что на Озоне, оба ответа', async () => {
        getPrices
            .mockResolvedValueOnce(onOzon({ '564323': [3359, 6718, 1680], '551444': [1200, 2400, 600] }))
            .mockResolvedValueOnce(onOzon({ '551444': [1200, 2400, 600] }));
        await command.execute(
            ctx({
                result: [{ offer_id: '551444', updated: false, errors: [{ code: 'PRICE_TOO_LOW', message: 'x' }] }],
            }),
        );
        expect(emit).toHaveBeenCalledTimes(1);
        const [event, subject, text, topic] = emit.mock.calls[0];
        expect(event).toBe('error.message');
        expect(subject).toBe('Цены Озона не встали: 1');
        expect(topic).toBe('PRICES');
        expect(text).toContain('551444: посчитали 900/1800/450 — на Озоне 1200/2400/600');
        expect(text).toContain('Озон ответил: отказ: PRICE_TOO_LOW x, на повтор: принят');
    });

    it('товара нет в ответе Озона — тоже расхождение', async () => {
        getPrices.mockResolvedValueOnce(onOzon({ '564323': [3359, 6718, 1680] })).mockResolvedValueOnce(onOzon({}));
        await command.execute(ctx());
        expect(emit.mock.calls[0][2]).toContain('551444: посчитали 900/1800/450 — на Озоне нет данных');
    });

    it('Озону ничего не отправляли — не читаем', async () => {
        await command.execute({
            skus: [],
            priceReports: [{ service: GoodServiceEnum.WB, inputs: [], sent, skipped: [], response: null }],
        });
        expect(getPrices).not.toHaveBeenCalled();
    });

    it('сбой чтения цен не роняет цепочку', async () => {
        getPrices.mockRejectedValueOnce(new Error('Ozon 500'));
        const c = ctx();
        await expect(command.execute(c)).resolves.toBe(c);
        expect(emit).not.toHaveBeenCalled();
    });

    it('собирается контейнером Nest (forwardRef на ExtraPriceService, ProductService, Config, EventEmitter)', async () => {
        const module = await Test.createTestingModule({
            providers: [
                VerifyOzonPricesCommand,
                { provide: ExtraPriceService, useValue: {} },
                { provide: ProductService, useValue: {} },
                { provide: ConfigService, useValue: { get: () => 0 } },
                { provide: EventEmitter2, useValue: { emit: jest.fn() } },
            ],
        }).compile();
        expect(module.get(VerifyOzonPricesCommand)).toBeInstanceOf(VerifyOzonPricesCommand);
    });
});
