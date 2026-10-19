import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { VaultService } from 'vault-module/lib/vault.service';
import { WbCurrentPricesModule } from './wb.current-prices.module';
import { WbCurrentPricesService } from './wb.current-prices.service';

/** Vault в приложении глобальный (VaultModule.forRootAsync) — здесь его подменяем так же глобально. */
@Global()
@Module({ providers: [{ provide: VaultService, useValue: {} }], exports: [VaultService] })
class FakeVaultModule {}

describe('WbCurrentPricesModule — старт контейнера Nest', () => {
    it('модуль сам собирает сервис цен карточки (зависимости импортированы)', async () => {
        const module = await Test.createTestingModule({ imports: [FakeVaultModule, WbCurrentPricesModule] }).compile();
        expect(module.get(WbCurrentPricesService)).toBeInstanceOf(WbCurrentPricesService);
    });
});
