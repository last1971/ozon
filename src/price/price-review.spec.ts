import { JobService } from '../job/job.service';
import { PriceReviewService } from './price-review.service';
import { PreparePriceReviewCommand, SendPriceReviewCommand } from './price-review.commands';
import { GoodServiceEnum } from '../good/good.service.enum';
import { calculatePrice } from '../helpers/price/price.helpers';

function setup() {
    const jobs = new JobService();
    const coeffs = { minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 };
    const input = {
        offer_id: '123',
        incoming_price: 100,
        available_price: 0,
        min_perc: 20,
        perc: 40,
        old_perc: 80,
        adv_perc: 0,
        sum_pack: 0,
        sales_percent: 20,
        fbs_direct_flow_trans_max_amount: 10,
    };
    const ozon = {
        getObtainCoeffs: () => coeffs,
        updatePrices: jest.fn().mockResolvedValue({ result: [{ offer_id: '123', updated: true }] }),
    };
    const wb = { getObtainCoeffs: () => coeffs, updatePrices: jest.fn().mockResolvedValue({ data: { id: 1 } }) };
    const extra = {
        getService: (name: string) => (name === GoodServiceEnum.OZON ? ozon : name === GoodServiceEnum.WB ? wb : null),
    };
    const goods = { buildPriceables: jest.fn().mockImplementation(async () => [{ ...input }]), setPercents: jest.fn() };
    const prepare = new PreparePriceReviewCommand(extra as any, goods as any);
    const send = new SendPriceReviewCommand(extra as any, new PreparePriceReviewCommand(extra as any, goods as any));
    const service = new PriceReviewService(jobs, prepare, send);
    const preview = async () => (await jobs.whenDone(service.prepareReview('123').id)).result as any;
    return { jobs, ozon, wb, goods, service, preview, input, coeffs, extra };
}
describe('Предпросмотр и подтверждённая отправка цен', () => {
    it('подготовка использует общую формулу и ничего не сохраняет/не отправляет', async () => {
        const m = setup(),
            review = await m.preview();
        expect(review.entries.map((e) => e.service)).toEqual(['ozon', 'wb']);
        expect(review.entries[0].prices).toEqual([calculatePrice(m.input, m.coeffs)]);
        expect(m.ozon.updatePrices).not.toHaveBeenCalled();
        expect(m.wb.updatePrices).not.toHaveBeenCalled();
        expect(m.goods.setPercents).not.toHaveBeenCalled();
        expect(review.token).toBeTruthy();
    });
    it('отправляет ровно серверный снимок, повтор подтверждения не дублирует запись', async () => {
        const m = setup(),
            review = await m.preview();
        const expected = structuredClone(review.entries[0].prices);
        review.entries[0].prices[0].price = '1';
        const first = m.service.sendReview(review.token),
            second = m.service.sendReview(review.token);
        expect(first.id).toBe(second.id);
        const done = await m.jobs.whenDone(first.id);
        expect(done).toMatchObject({ status: 'done', progress: { percent: 100 } });
        expect(m.ozon.updatePrices).toHaveBeenCalledTimes(1);
        expect(m.ozon.updatePrices).toHaveBeenCalledWith(expected);
        expect(m.goods.buildPriceables).toHaveBeenCalledTimes(4);
        expect(m.goods.setPercents).not.toHaveBeenCalled();
    });
    it('просроченный или поддельный снимок не отправляется', async () => {
        const m = setup(),
            review = await m.preview();
        const now = jest.spyOn(Date, 'now').mockReturnValue(review.expiresAt + 1);
        try {
            expect(() => m.service.sendReview(review.token)).toThrow('устарел');
        } finally {
            now.mockRestore();
        }
        expect(() => m.service.sendReview('foreign')).toThrow('устарел');
        expect(m.ozon.updatePrices).not.toHaveBeenCalled();
    });
    it('ошибка одной площадки при подготовке не скрывает остальные; ошибка не отправляется', async () => {
        const m = setup();
        m.goods.buildPriceables.mockRejectedValueOnce(new Error('Нет тарифа'));
        const review = await m.preview();
        expect(review.entries[0]).toMatchObject({ error: 'Нет тарифа', prices: [] });
        await m.jobs.whenDone(m.service.sendReview(review.token).id);
        expect(m.ozon.updatePrices).not.toHaveBeenCalled();
        expect(m.wb.updatePrices).toHaveBeenCalledTimes(1);
    });
    it('пустой расчёт не допускает подтверждения', async () => {
        const m = setup();
        m.goods.buildPriceables.mockResolvedValue([]);
        const review = await m.preview();
        expect(() => m.service.sendReview(review.token)).toThrow('Нет цен');
    });
    it('отказ Ozon и ошибка ВБ видны отдельно после отправки', async () => {
        const m = setup(),
            review = await m.preview();
        m.ozon.updatePrices.mockResolvedValue({ result: [{ offer_id: '123', updated: false }] });
        m.wb.updatePrices.mockRejectedValue(new Error('ВБ недоступен'));
        const done = await m.jobs.whenDone(m.service.sendReview(review.token).id);
        expect((done.result as any).entries.map((e) => Boolean(e.error))).toEqual([true, true]);
    });
});

it('изменившийся расчёт не отправляет ни старые, ни новые неподтверждённые суммы', async () => {
    const m = setup(),
        review = await m.preview();
    m.input.perc = 900;
    const done = await m.jobs.whenDone(m.service.sendReview(review.token).id);
    expect(m.ozon.updatePrices).not.toHaveBeenCalled();
    expect(m.wb.updatePrices).not.toHaveBeenCalled();
    expect((done.result as any).entries.every((e) => e.error.includes('Подготовьте цены заново'))).toBe(true);
});

it('площадка, отключённая после предпросмотра, не отправляет цену и не мешает другой', async () => {
    const m = setup(),
        review = await m.preview();
    jest.spyOn(m.extra, 'getService').mockImplementation((name) => (name === GoodServiceEnum.WB ? m.wb : null));
    const done = await m.jobs.whenDone(m.service.sendReview(review.token).id);
    expect(m.ozon.updatePrices).not.toHaveBeenCalled();
    expect(m.wb.updatePrices).toHaveBeenCalledTimes(1);
    expect((done.result as any).entries[0].error).toContain('Площадка отключена');
});
