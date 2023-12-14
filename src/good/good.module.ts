import { Module } from '@nestjs/common';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { GoodController } from './good.controller';
import { ProductModule } from '../product/product.module';
import { YandexOfferModule } from '../yandex.offer/yandex.offer.module';
import { ConfigService } from '@nestjs/config';
import { WbCardModule } from '../wb.card/wb.card.module';
import { FirebirdPool } from 'ts-firebird';
import { ExtraGoodService } from './extra.good.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Module({
    imports: [FirebirdModule, ProductModule, YandexOfferModule, WbCardModule],
    providers: [
        {
            provide: GOOD_SERVICE,
            useFactory: (pool: FirebirdPool, configService: ConfigService, eventEmitter: EventEmitter2) =>
                new Trade2006GoodService(pool, configService, eventEmitter),
            inject: [FIREBIRD, ConfigService, EventEmitter2],
        },
        ExtraGoodService,
    ],
    exports: [GOOD_SERVICE, ExtraGoodService],
    controllers: [GoodController],
})
export class GoodModule {}
