import { LossReportService } from './loss-report.service';
const date = new Date('2026-11-07T07:00:00Z');
const setup = () => {
    const row = {
        offerId: '123-5',
        soldUnits: 10,
        returnedUnits: 3,
        writtenOffUnits: 1,
        returnRate: 0.3,
        defectRate: 0.1,
        expenses: {
            paidReturnDelivery: 30,
            cancellationDelivery: -10,
            sellerReturnDelivery: 20,
            confirmedDefectCompensation: 5,
        },
    };
    const snapshot = { service: 'WB', calculatedAt: date, rows: [row] };
    const store = { read: jest.fn().mockResolvedValue(snapshot), replace: jest.fn() };
    const prices = { getOzonPricingResult: jest.fn() };
    const goods = {
        prices: jest
            .fn()
            .mockResolvedValue([{ code: 123, price: 20, base_source: 'remaining-lots', available_price: 999 }]),
    };
    const products = { listAllOfferIds: jest.fn().mockResolvedValue(['123-5']) };
    return {
        row,
        snapshot,
        store,
        prices,
        goods,
        products,
        service: new LossReportService(store as any, prices as any, goods as any, products as any),
    };
};
describe('Представление статистики потерь, без записи и отправки цен', () => {
    it('возвращает исходный снимок без пересчёта процентов; отсутствующий снимок — null', async () => {
        const { service, store, snapshot } = setup();
        expect(await service.read('WB')).toBe(snapshot);
        store.read.mockResolvedValueOnce(null);
        expect(await service.read('WB')).toBeNull();
        expect(store.replace).not.toHaveBeenCalled();
    });
    it('ошибка БД не превращается в пустой снимок или нулевые расходы', async () => {
        const { service, store } = setup();
        store.read.mockRejectedValue(new Error('offline'));
        await expect(service.read('WB')).rejects.toThrow('offline');
        await expect(service.costs('WB', '123-5')).rejects.toThrow('offline');
    });
    it('ВБ: собственная фасовка, закупка вместо рыночной базы, фактические расходы на продажу', async () => {
        const { service, goods, prices, store } = setup();
        expect(await service.costs('WB', '123-5')).toEqual({
            offerId: '123-5',
            calculatedAt: date,
            costs: {
                returns: 3,
                cancellations: -1,
                sellerReturns: 2,
                defects: 9.5,
                defectCompensation: 0.5,
                total: 13.5,
            },
        });
        expect(goods.prices).toHaveBeenCalledWith(['123'], null);
        expect(store.read).toHaveBeenCalledWith('WB');
        expect(prices.getOzonPricingResult).not.toHaveBeenCalled();
        expect(store.replace).not.toHaveBeenCalled();
    });
    it('известные нулевые потери показываются нулями', async () => {
        const { service, row } = setup();
        Object.assign(row, {
            defectRate: 0,
            expenses: {
                paidReturnDelivery: 0,
                cancellationDelivery: 0,
                sellerReturnDelivery: 0,
                confirmedDefectCompensation: 0,
            },
        });
        expect((await service.costs('WB', '123-5')).costs).toMatchObject({ returns: 0, defects: 0, total: 0 });
    });
    it.each(['row', 'expenses', 'sales', 'unknown', 'tariff', 'purchase'])(
        'не выдаёт отсутствующие сведения за бесплатную доставку/брак: %s',
        async (kind) => {
            const { service, snapshot, row, goods, prices } = setup();
            if (kind === 'row') snapshot.rows = [];
            if (kind === 'expenses') delete row.expenses;
            if (kind === 'sales') row.soldUnits = 0;
            if (kind === 'unknown') row.expenses.cancellationDelivery = null;
            if (kind === 'tariff') delete row.expenses.paidReturnDelivery;
            if (kind === 'purchase') goods.prices.mockResolvedValue([]);
            const report = await service.costs('WB', '123-5');
            expect(report.costs).toBeNull();
            expect(report.error).toBeTruthy();
            expect(prices.getOzonPricingResult).not.toHaveBeenCalled();
        },
    );
    it('Яндекс с неизвестными возвратами не получает тариф Ozon', async () => {
        const { service, row, prices } = setup();
        row.expenses.paidReturnDelivery = null;
        const result = await service.costs('YANDEX', '123-5');
        expect(result.costs).toBeNull();
        expect(result.error).toContain('доставка оплаченных возвратов');
        expect(prices.getOzonPricingResult).not.toHaveBeenCalled();
    });
    it('Ozon: настоящий артикул -1, схема и все суммы взяты из существующего расчёта', async () => {
        const { service, row, prices, products, goods } = setup();
        row.offerId = '123';
        delete row.expenses.paidReturnDelivery;
        products.listAllOfferIds.mockResolvedValue(['123-1']);
        prices.getOzonPricingResult.mockResolvedValue({
            min: { price: 999, scheme: 'fbo' },
            costs: {
                returns: 7,
                cancellations: 2,
                sellerReturns: 3,
                defects: 4,
                defectCompensation: 1,
            },
        });
        expect(await service.costs('OZON', '123-1')).toEqual({
            offerId: '123',
            calculatedAt: date,
            price: 999,
            scheme: 'fbo',
            costs: { returns: 7, cancellations: 2, sellerReturns: 3, defects: 4, defectCompensation: 1 },
        });
        expect(prices.getOzonPricingResult).toHaveBeenCalledWith('123-1');
        expect(goods.prices).not.toHaveBeenCalled();
    });
    it.each(['card', 'calculation', 'incomplete'])('Ozon не маскирует ошибку %s', async (kind) => {
        const { service, products, prices } = setup();
        if (kind === 'card') products.listAllOfferIds.mockResolvedValue([]);
        else
            prices.getOzonPricingResult.mockResolvedValue(
                kind === 'calculation'
                    ? { error: 'Нет тарифа', costs: null }
                    : { min: { price: 123 }, costs: { returns: 1 } },
            );
        const report = await service.costs('OZON', '123-5');
        expect(report.costs).toBeNull();
        expect(report.error).toBeTruthy();
    });
    it('проверяет артикул до чтения БД', async () => {
        const { service, store } = setup();
        await expect(service.costs('WB', '123-0')).rejects.toThrow('Некорректный артикул');
        expect(store.read).not.toHaveBeenCalled();
    });
});
