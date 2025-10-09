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
});
