import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import { VaultService } from 'vault-module/lib/vault.service';
import { MpReturnModule } from './mp-return.module';
import { MpReturnService } from './mp-return.service';
import { RETURN_SOURCES } from './sources/i.return.source';

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

describe('MpReturnModule — старт контейнера Nest', () => {
    it('собирает экран возвратов с источниками Ozon, ВБ и Яндекса (зависимости импортированы)', async () => {
        const module = await Test.createTestingModule({
            imports: [
                FakeGlobalsModule,
                ConfigModule.forRoot({ isGlobal: true }),
                EventEmitterModule.forRoot(),
                MpReturnModule,
            ],
        }).compile();
        expect(module.get(MpReturnService)).toBeInstanceOf(MpReturnService);
        expect(module.get(RETURN_SOURCES).map((s) => s.service)).toEqual(['OZON', 'WB', 'YANDEX']);
    });
});
