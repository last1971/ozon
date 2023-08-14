import { Module } from '@nestjs/common';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { GoodController } from './good.controller';
import { ProductModule } from '../product/product.module';
import { YandexOfferModule } from '../yandex.offer/yandex.offer.module';
import { ConfigService } from '@nestjs/config';

@Module({
    imports: [FirebirdModule, ProductModule, YandexOfferModule],
    providers: [
        {
            provide: GOOD_SERVICE,
            useFactory: (dataBase: FirebirdDatabase, configService: ConfigService) =>
                new Trade2006GoodService(dataBase, configService),
            inject: [FIREBIRD, ConfigService],
        },
    ],
    exports: [GOOD_SERVICE],
    controllers: [GoodController],
})
export class GoodModule {}
