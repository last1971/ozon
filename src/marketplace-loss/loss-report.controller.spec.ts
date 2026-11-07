import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { LossReportController } from './loss-report.controller';
import { LossReportService } from './loss-report.service';
import { LossMarketsService, LOSS_RECALCULATORS } from './loss-markets.service';
import { MarketplaceLossApiModule } from './marketplace-loss-api.module';
import { OzonReturnService } from '../trade2006.accrual/ozon.return.service';
import { Trade2006AccrualModule } from '../trade2006.accrual/trade2006.accrual.module';

describe('API статистики выбранной площадки', () => {
    let app;
    const report = { read: jest.fn(), costs: jest.fn() };
    const runners = { OZON: { start: jest.fn() }, WB: { start: jest.fn() }, YANDEX: { start: jest.fn() } };
    beforeEach(async () => {
        jest.resetAllMocks();
        const module = await Test.createTestingModule({
            controllers: [LossReportController],
            providers: [
                LossMarketsService,
                { provide: LossReportService, useValue: report },
                { provide: ConfigService, useValue: { get: () => 'ozon, wb' } },
                { provide: LOSS_RECALCULATORS, useValue: runners },
            ],
        }).compile();
        app = module.createNestApplication();
        app.setGlobalPrefix('api');
        await app.init();
    });
    afterEach(async () => app.close());
    it('список ограничен подключёнными адаптерами', async () => {
        const { body } = await request(app.getHttpServer()).get('/api/marketplace-loss').expect(200);
        expect(body).toEqual([
            { service: 'OZON', label: 'Ozon' },
            { service: 'WB', label: 'ВБ' },
        ]);
    });
    it('передаёт выбранную площадку и не изменяет NULL/0/проценты выше 100%', async () => {
        report.read.mockResolvedValue({
            service: 'WB',
            rows: [{ returnRate: null, defectRate: 0 }, { returnRate: 1.5 }],
        });
        const { body } = await request(app.getHttpServer()).get('/api/marketplace-loss/wb').expect(200);
        expect(body.rows).toEqual([{ returnRate: null, defectRate: 0 }, { returnRate: 1.5 }]);
        expect(report.read).toHaveBeenCalledWith('WB');
        Object.values(runners).forEach((r) => expect(r.start).not.toHaveBeenCalled());
    });
    it('возвращает job сразу и передаёт метку браузера только своей цепочке', async () => {
        runners.OZON.start.mockReturnValue({ id: 'job-1', status: 'running' });
        const { body } = await request(app.getHttpServer())
            .post('/api/marketplace-loss/ozon/recalculate')
            .set('X-Client-Id', 'browser-1')
            .expect(202);
        expect(body).toEqual({ id: 'job-1', status: 'running' });
        expect(runners.OZON.start).toHaveBeenCalledWith('browser-1');
        expect(runners.WB.start).not.toHaveBeenCalled();
        expect(report.read).not.toHaveBeenCalled();
    });
    it.each(['yandex', 'avito', 'invalid'])(
        'отвергает неподключённую площадку %s до доступа к данным',
        async (service) => {
            await request(app.getHttpServer()).get(`/api/marketplace-loss/${service}`).expect(400);
            await request(app.getHttpServer()).post(`/api/marketplace-loss/${service}/recalculate`).expect(400);
            expect(report.read).not.toHaveBeenCalled();
            Object.values(runners).forEach((r) => expect(r.start).not.toHaveBeenCalled());
        },
    );
    it('расходы используют выбранную площадку и фасовку', async () => {
        report.costs.mockResolvedValue({ offerId: '123-5', costs: null, error: 'Нет продаж' });
        const { body } = await request(app.getHttpServer()).get('/api/marketplace-loss/WB/123-5/costs').expect(200);
        expect(report.costs).toHaveBeenCalledWith('WB', '123-5');
        expect(body.error).toBe('Нет продаж');
    });
    it('Ozon экспортирует единственную цепочку, API зарегистрирован отдельно от ядра', () => {
        expect(Reflect.getMetadata('exports', Trade2006AccrualModule)).toContain(OzonReturnService);
        expect(Reflect.getMetadata('controllers', MarketplaceLossApiModule)).toContain(LossReportController);
    });
});
