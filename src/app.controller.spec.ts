import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GOOD_SERVICE } from './interfaces/IGood';
import { ProductService } from './product/product.service';
import { YandexOfferService } from './yandex.offer/yandex.offer.service';
import { ExpressOfferService } from './yandex.offer/express.offer.service';
import { WbCardService } from './wb.card/wb.card.service';
import { ConfigService } from '@nestjs/config';
import { VaultService } from 'vault-module/lib/vault.service';
import { FIREBIRD } from './firebird/firebird.module';
import { NotifierService } from './notify/notifier.service';
import { NotifyTopic } from './notify/notify.types';

describe('AppController', () => {
    let appController: AppController;
    let vaultService: VaultService;

    beforeEach(async () => {
        const app: TestingModule = await Test.createTestingModule({
            controllers: [AppController],
            providers: [
                AppService,
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: ProductService, useValue: {} },
                { provide: YandexOfferService, useValue: {} },
                { provide: ExpressOfferService, useValue: {} },
                { provide: WbCardService, useValue: {} },
                { provide: ConfigService, useValue: {} },
                {
                    provide: VaultService,
                    useValue: {
                        clearCache: jest.fn(),
                    },
                },
                {
                    provide: FIREBIRD,
                    useValue: {
                        getMaxConnections: jest.fn().mockReturnValue(10),
                        getActiveConnectionsCount: jest.fn().mockReturnValue(5),
                        getAvailableConnectionsCount: jest.fn().mockReturnValue(5),
                        getActiveTransactionsCount: jest.fn().mockReturnValue(2),
                        getTransaction: jest.fn(),
                    },
                },
                {
                    provide: NotifierService,
                    useValue: {
                        test: jest.fn().mockResolvedValue({ ok: true }),
                        notify: jest.fn().mockResolvedValue(true),
                    },
                },
            ],
        }).compile();

        appController = app.get<AppController>(AppController);
        vaultService = app.get<VaultService>(VaultService);
    });

    describe('root', () => {
        it('should return "Hello World!"', () => {
            expect(appController.getHello()).toBe('Hello World!');
        });
    });

    describe('clearVaultCache', () => {
        it('should clear vault cache and return success message', async () => {
            const result = await appController.clearVaultCache();

            expect(vaultService.clearCache).toHaveBeenCalled();
            expect(result).toEqual({ message: 'Vault cache cleared successfully' });
        });
    });

    describe('health/db', () => {
        const pool = () => (appController as any).pool;

        it('база ответила — ok', async () => {
            pool().getTransaction.mockResolvedValue({
                query: jest.fn().mockResolvedValue([]),
                commit: jest.fn().mockResolvedValue(undefined),
            });
            await expect(appController.dbHealth()).resolves.toEqual(expect.objectContaining({ ok: true }));
        });

        it('база не ответила — 503 со статистикой пула', async () => {
            pool().getTransaction.mockRejectedValue(new Error('Connection shutdown'));
            await expect(appController.dbHealth()).rejects.toMatchObject({
                status: 503,
                response: expect.objectContaining({
                    ok: false,
                    error: 'Connection shutdown',
                    pool: expect.any(Object),
                }),
            });
        });
    });

    it('notify/event — через notifier по теме', async () => {
        const notifier = (appController as any).notifier;
        await expect(appController.notifyEvent({ topic: NotifyTopic.DEV, subject: 'с', text: 'т' })).resolves.toEqual({
            ok: true,
        });
        expect(notifier.notify).toHaveBeenCalledWith(NotifyTopic.DEV, { subject: 'с', text: 'т' });
    });
});
