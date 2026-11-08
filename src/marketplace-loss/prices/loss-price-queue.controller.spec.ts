import { CheckLossPriceStockCommand } from './check-loss-price-stock.command';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { LossPriceQueueController } from './loss-price-queue.controller';
import { LossPriceUpdateService } from './loss-price-update.service';
import { LossPriceQueueStore } from './loss-price-queue.store';
import { JobService } from '../../job/job.service';
import { LOSS_PRICE_ADAPTERS } from './loss-price.contracts';
import {
    LoadLossPriceTasksCommand,
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
    FinishLossPriceTasksCommand,
} from './loss-price.commands';
import { MarketplaceLossModule } from '../marketplace-loss.module';
import { Trade2006AccrualModule } from '../../trade2006.accrual/trade2006.accrual.module';
import { LossPriceUpdateModule } from './loss-price-update.module';
import { MpEventModule } from '../../mp-event/mp-event.module';
import { PromosModule } from '../../promos/promos.module';

describe('API очереди и подключение к существующим модулям', () => {
    let app;
    const queue = { pending: jest.fn().mockResolvedValue([]), finish: jest.fn() };
    beforeEach(async () => {
        jest.clearAllMocks();
        const noop = { execute: async (ctx) => ctx };
        const module = await Test.createTestingModule({
            controllers: [LossPriceQueueController],
            providers: [
                LossPriceUpdateService,
                JobService,
                { provide: ConfigService, useValue: new ConfigService({ SERVICES: ['wb'] }) },
                { provide: LossPriceQueueStore, useValue: queue },
                { provide: LOSS_PRICE_ADAPTERS, useValue: { WB: {} } },
                ...[
                    LoadLossPriceTasksCommand,
                    CalculateLossPriceTargetsCommand,
                    CompareLossPricesCommand,
                    SendLossPricesCommand,
                    ConfirmLossPricesCommand,
                    CheckLossPricePromosCommand,
                    FinishLossPriceTasksCommand,
                    CheckLossPriceStockCommand,
                ].map((provide) => ({ provide, useValue: noop })),
            ],
        }).compile();
        app = module.createNestApplication();
        app.setGlobalPrefix('api');
        // Для bootstrap и ручек используются только пустые тестовые команды, без реальных API.
        await app.init();
    });
    afterEach(async () => app.close());
    it('чтение не запускает отправку; POST возвращает задачу с меткой браузера', async () => {
        await request(app.getHttpServer()).get('/api/marketplace-loss/WB/prices').expect(200, []);
        expect(queue.pending).toHaveBeenCalledWith('WB');
        const { body } = await request(app.getHttpServer())
            .post('/api/marketplace-loss/wb/prices')
            .set('X-Client-Id', 'browser')
            .expect(202);
        expect(body).toMatchObject({ kind: 'loss-price-update:wb', clientId: 'browser' });
    });
    it.each(['OZON', 'YANDEX', 'AVITO'])('не запускает неподключённую площадку %s', async (service) => {
        await request(app.getHttpServer()).get(`/api/marketplace-loss/${service}/prices`).expect(400);
        await request(app.getHttpServer()).post(`/api/marketplace-loss/${service}/prices`).expect(400);
        expect(queue.pending).not.toHaveBeenCalled();
    });
    it('общая очередь зарегистрирована для обоих хранилищ; модуль обработчика отдельно от ядра', () => {
        expect(Reflect.getMetadata('providers', MarketplaceLossModule)).toContain(LossPriceQueueStore);
        expect(Reflect.getMetadata('imports', Trade2006AccrualModule)).toContain(MarketplaceLossModule);
        expect(Reflect.getMetadata('imports', MarketplaceLossModule)).toContain(MpEventModule);
        expect(Reflect.getMetadata('imports', LossPriceUpdateModule)).toContain(PromosModule);
    });
});
