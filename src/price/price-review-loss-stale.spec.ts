import { JobService } from '../job/job.service';
import { PriceReviewService } from './price-review.service';
import { PreparePriceReviewCommand, SendPriceReviewCommand } from './price-review.commands';
import { priceUpdateQueue } from '../helpers/price/price-update.queue';
const setup = () => {
    const jobs = new JobService();
    const coeffs = { minMil: 0, percMil: 0, percEkv: 1, sumObtain: 0, sumLabel: 0, taxUnit: 6 };
    const ozon = {
        getObtainCoeffs: () => coeffs,
        updatePrices: jest.fn().mockResolvedValue({ result: [{ offer_id: '123', updated: true }] }),
    };
    const wb = { getObtainCoeffs: () => coeffs, updatePrices: jest.fn().mockResolvedValue({ data: { id: 1 } }) };
    const extra = { getService: (name) => (name === 'ozon' ? ozon : name === 'wb' ? wb : null) };
    const goods = {
        buildPriceables: jest.fn().mockResolvedValue([
            {
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
            },
        ]),
    };
    const service = new PriceReviewService(
        jobs,
        new PreparePriceReviewCommand(extra as any, goods as any),
        new SendPriceReviewCommand(extra as any, new PreparePriceReviewCommand(extra as any, goods as any)),
    );
    const preview = async () => (await jobs.whenDone(service.prepareReview('123').id)).result as any;
    return { jobs, service, ozon, wb, preview, goods };
};
it('новый снимок запрещает устаревшие суммы только своей площадки', async () => {
    const s = setup();
    const review = await s.preview();
    s.service.lossSaved('OZON');
    const done = await s.jobs.whenDone(s.service.sendReview(review.token).id);
    expect(s.ozon.updatePrices).not.toHaveBeenCalled();
    expect(s.wb.updatePrices).toHaveBeenCalledTimes(1);
    expect((done.result as any).entries[0].error).toContain('Подготовьте цены заново');
});
it('проверка выполняется после ожидания общей очереди, а не до него', async () => {
    const s = setup();
    const review = await s.preview();
    let release: () => void;
    const held = priceUpdateQueue.run(
        'ozon',
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    while (!release) await new Promise<void>((resolve) => setImmediate(resolve));
    const sending = s.service.sendReview(review.token);
    s.service.lossSaved('OZON');
    release();
    await held;
    await s.jobs.whenDone(sending.id);
    expect(s.ozon.updatePrices).not.toHaveBeenCalled();
});
it('после нового предпросмотра отправка разрешена; изменение в ходе подготовки также замечается', async () => {
    const s = setup();
    s.service.lossSaved('OZON');
    const current = await s.preview();
    await s.jobs.whenDone(s.service.sendReview(current.token).id);
    expect(s.ozon.updatePrices).toHaveBeenCalledTimes(1);
    s.goods.buildPriceables.mockImplementationOnce(async () => {
        s.service.lossSaved('OZON');
        return [];
    });
    const review = await s.preview();
    await s.jobs.whenDone(s.service.sendReview(review.token).id);
    expect(s.ozon.updatePrices).toHaveBeenCalledTimes(1);
});

it('смена даты и изменения другого товара не запрещают актуальный предпросмотр', async () => {
    const s = setup();
    const review = await s.preview();
    s.service.lossSaved('OZON', []);
    s.service.lossSaved('OZON', ['456']);
    await s.jobs.whenDone(s.service.sendReview(review.token).id);
    expect(s.ozon.updatePrices).toHaveBeenCalledTimes(1);
});
it('изменение канонического кода отменяет предпросмотр той же упаковки', async () => {
    const s = setup();
    const review = await s.preview();
    s.service.lossSaved('OZON', ['123-1']);
    await s.jobs.whenDone(s.service.sendReview(review.token).id);
    expect(s.ozon.updatePrices).not.toHaveBeenCalled();
});

it('срок предпросмотра проверяется снова после ожидания очереди', async () => {
    const s = setup(),
        review = await s.preview();
    let release: () => void;
    const held = priceUpdateQueue.run('ozon', () => new Promise<void>((r) => (release = r)));
    while (!release) await new Promise(setImmediate);
    const job = s.service.sendReview(review.token);
    while (!priceUpdateQueue.state('ozon').manual) await new Promise(setImmediate);
    const now = jest.spyOn(Date, 'now').mockReturnValue(review.expiresAt + 1);
    try {
        release();
        await held;
        const done = await s.jobs.whenDone(job.id);
        expect(s.ozon.updatePrices).not.toHaveBeenCalled();
        expect((done.result as any).entries[0].error).toContain('Предпросмотр устарел');
    } finally {
        now.mockRestore();
    }
});
