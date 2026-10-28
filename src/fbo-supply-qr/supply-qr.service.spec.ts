import { BadRequestException } from '@nestjs/common';
import { SupplyQrService } from './supply-qr.service';
import { MarkState, SupplyQrRecord, SupplyQrStore } from './supply-qr.store';
import { BindQrDto } from './dto/supply-qr.dto';

const KI = '0100400004390167215O.TgmWo*G)DW66eekep';
const CARGO = '1022117471311000';

/** База узла в памяти: привязки, штрихкоды товаров, коды ЧЗ. */
function fakeStore(opts: { gtin?: Record<string, number[]>; marks?: Record<string, MarkState> } = {}) {
    const rows: SupplyQrRecord[] = [];
    const t = { commit: jest.fn(), rollback: jest.fn().mockResolvedValue(undefined) };
    const store = {
        transaction: jest.fn().mockResolvedValue(t),
        byQr: jest.fn(async (qr: string) => rows.find((r) => r.qr === qr) ?? null),
        byMarkcode: jest.fn(async (mc: number) => rows.find((r) => r.markcode === mc) ?? null),
        byCargo: jest.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.cargoId))),
        countBound: jest.fn(
            async (cargo: string, offer: string) =>
                rows.filter((r) => r.cargoId === cargo && r.offerId === offer).length,
        ),
        insert: jest.fn(async (rec) => {
            rows.push({ ...rec, ki: rec.markcode ? KI : null, createdAt: new Date('2026-10-28T10:00:00Z') });
        }),
        delete: jest.fn(),
        goodsByGtin: jest.fn(async (gtins: string[]) => [...new Set(gtins.flatMap((g) => opts.gtin?.[g] ?? []))]),
        markByKi: jest.fn(async (ki: string) => opts.marks?.[ki] ?? null),
        names: jest.fn(async (gcs: number[]) => new Map(gcs.map((gc) => [gc, `товар ${gc}`]))),
    };
    return { store, rows, t };
}

const lines = [
    { offerId: '562990', ozonBarcode: 'OZN1754772007', need: 2 },
    { offerId: '555555', ozonBarcode: 'OZN5', need: 1 },
    { offerId: '555555-10', ozonBarcode: 'OZN50', need: 1 },
];
const bind = (scan: string, qr: string, extra: Partial<BindQrDto> = {}): BindQrDto => ({
    cargoId: CARGO,
    lines,
    scan,
    qr,
    username: 'Иванов',
    ...extra,
});
const freeMark = (over: Partial<MarkState> = {}): MarkState => ({
    markcode: 2983,
    goodscode: 555555,
    status: 5,
    transferType: 0,
    quantity: 10,
    realpricecode: null,
    lineGoodscode: null,
    invoiceNumber: null,
    invoicePrim: null,
    ...over,
});

async function refusal(p: Promise<unknown>): Promise<string> {
    const e: any = await p.catch((err) => err);
    expect(e).toBeInstanceOf(BadRequestException);
    return e.message;
}

describe('SupplyQrService — привязка этикетки к экземпляру', () => {
    it('штрихкод товара (любой из его GTIN) → строка коробки; QR приводится к нижнему регистру', async () => {
        const { store, rows, t } = fakeStore({ gtin: { '04607001234567': [562990] } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        const res = await svc.bind(bind('4607001234567', 'II50126995216'));
        expect(res).toMatchObject({ qr: 'ii50126995216', offerId: '562990', goodscode: 562990, ki: null });
        expect(rows[0]).toMatchObject({ ozonBarcode: 'OZN1754772007', markcode: null, username: 'Иванов' });
        expect(t.commit).toHaveBeenCalled();
    });

    it('штрихкод Озона с карточки — сразу артикул', async () => {
        const { store } = fakeStore();
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        expect((await svc.bind(bind('OZN1754772007', 'ii1000001'))).offerId).toBe('562990');
    });

    it('сверх нужного количества — отказ', async () => {
        const { store } = fakeStore({ gtin: { '04607001234567': [562990] } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        await svc.bind(bind('4607001234567', 'ii1000001'));
        await svc.bind(bind('4607001234567', 'ii1000002'));
        expect(await refusal(svc.bind(bind('4607001234567', 'ii1000003')))).toContain('уже набрано 2 из 2');
    });

    it('этикетка уже наклеена — отказ, откат', async () => {
        const { store, t } = fakeStore({ gtin: { '04607001234567': [562990] } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        await svc.bind(bind('4607001234567', 'ii1000001'));
        expect(await refusal(svc.bind(bind('4607001234567', 'ii1000001')))).toContain('уже наклеена');
        expect(t.rollback).toHaveBeenCalled();
    });

    it('товар к двум фасовкам по штрихкоду — просим выбрать; выбранный — пишем', async () => {
        const { store } = fakeStore({ gtin: { '04600000000017': [555555] } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        expect(await refusal(svc.bind(bind('4600000000017', 'ii1000001')))).toContain('выберите');
        expect((await svc.bind(bind('4600000000017', 'ii1000001', { offerId: '555555-10' }))).offerId).toBe(
            '555555-10',
        );
    });

    it('количественный КМ сам выбирает фасовку своего количества и запоминается', async () => {
        const { store, rows } = fakeStore({ marks: { [KI]: freeMark() } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        const res = await svc.bind(bind(KI, 'ii1000001'));
        expect(res).toMatchObject({ offerId: '555555-10', ki: KI });
        expect(rows[0].markcode).toBe(2983);
    });

    it('КМ, который нельзя продать, — отказ с причиной', async () => {
        const { store } = fakeStore({
            marks: {
                [KI]: freeMark({
                    realpricecode: 5,
                    lineGoodscode: 555555,
                    invoiceNumber: 85001,
                    invoicePrim: 'розница',
                }),
            },
        });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        expect(await refusal(svc.bind(bind(KI, 'ii1000001')))).toContain('в резерве под счёт №85001');
    });

    it('КМ уже с этикеткой — отказ', async () => {
        const { store } = fakeStore({ marks: { [KI]: freeMark() } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        await svc.bind(bind(KI, 'ii1000001'));
        expect(await refusal(svc.bind(bind(KI, 'ii1000002')))).toContain('уже наклеена этикетка ii1000001');
    });

    it('КМ на 1 шт к коробке с фасовкой 10 — отказ с подсказкой', async () => {
        const one = [{ offerId: '555555-10', ozonBarcode: '', need: 1 }];
        const { store } = fakeStore({ marks: { [KI]: freeMark({ quantity: 1 }) } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        expect(await refusal(svc.bind(bind(KI, 'ii1000001', { lines: one })))).toContain('Код ЧЗ на 1 шт');
    });

    it('товара нет в коробке / чужой штрихкод / вместо товара этикетка', async () => {
        const { store } = fakeStore({ gtin: { '04607001234567': [111] } });
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        expect(await refusal(svc.resolve(bind('4607001234567', 'ii1')))).toContain('нет в коробке');
        expect(await refusal(svc.resolve(bind('4600000000000', 'ii1')))).toContain('не найден в базе');
        expect(await refusal(svc.resolve(bind('ii50126995216', 'ii1')))).toContain('этикетка Озона');
        expect(await refusal(svc.resolve(bind(CARGO, 'ii1')))).toContain('этикетка коробки');
        expect(await refusal(svc.resolve(bind('OZN1020101362', 'ii1')))).toContain('не из коробки');
    });

    it('этикетка не ii… — отказ до базы', async () => {
        const { store } = fakeStore();
        const svc = new SupplyQrService(store as unknown as SupplyQrStore);
        expect(await refusal(svc.bind(bind('OZN1754772007', '4607001234567')))).toContain('не этикетка Озона');
        expect(store.transaction).not.toHaveBeenCalled();
    });
});
