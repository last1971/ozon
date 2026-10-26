import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import { VaultService } from 'vault-module/lib/vault.service';
import { WbOrderModule } from './wb.order.module';
import { WbOrderService } from './wb.order.service';

/** Глобальные модули приложения (Vault, кэш Redis) — подменяем так же глобально. */
@Global()
@Module({
    providers: [
        { provide: VaultService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: {} },
        { provide: Cache, useValue: {} },
    ],
    exports: [VaultService, CACHE_MANAGER, Cache],
})
class FakeGlobalsModule {}

describe('WbOrderModule — старт контейнера Nest', () => {
    it('собирает сервис заказов ВБ с отчётом возвратов (WbGoodsReturnReportService из WbApiModule)', async () => {
        const module = await Test.createTestingModule({
            imports: [
                FakeGlobalsModule,
                ConfigModule.forRoot({ isGlobal: true }),
                EventEmitterModule.forRoot(),
                WbOrderModule,
            ],
        }).compile();
        expect(module.get(WbOrderService)).toBeInstanceOf(WbOrderService);
    });
});
