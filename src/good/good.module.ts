import { forwardRef, Module } from '@nestjs/common';
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
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { PriceCalculationHelper } from "../helpers/price/price.calculation.helper";
import { HelpersModule } from "../helpers/helpers.module";
import { AvitoCardModule } from '../avito.card/avito.card.module';
import { SyliusModule } from '../sylius/sylius.module';
import { ResolveDisableTokensCommand } from './commands/resolve-disable-tokens.command';
import { WriteDisabledFlagCommand } from './commands/write-disabled-flag.command';
import { ClearDisabledFlagCommand } from './commands/clear-disabled-flag.command';
import { PushZeroCountsCommand } from './commands/push-zero-counts.command';
import { RestoreCountsCommand } from './commands/restore-counts.command';
import { GoodsCountProcessor } from '../helpers/good/goods.count.processor';

@Module({
    imports: [FirebirdModule, ProductModule, YandexOfferModule, WbCardModule, HelpersModule, forwardRef(() => AvitoCardModule), SyliusModule],
    providers: [
        {
            provide: GOOD_SERVICE,
            useFactory: (
                pool: FirebirdPool,
                configService: ConfigService,
                eventEmitter: EventEmitter2,
                cacheManager: Cache,
                priceCalculationHelper: PriceCalculationHelper,
            ) => new Trade2006GoodService(pool, configService, eventEmitter, cacheManager, priceCalculationHelper),
            inject: [FIREBIRD, ConfigService, EventEmitter2, CACHE_MANAGER, PriceCalculationHelper],
        },
        ExtraGoodService,
        GoodsCountProcessor,
        ResolveDisableTokensCommand,
        WriteDisabledFlagCommand,
        ClearDisabledFlagCommand,
        PushZeroCountsCommand,
        RestoreCountsCommand,
    ],
    exports: [GOOD_SERVICE, ExtraGoodService],
    controllers: [GoodController],
})
export class GoodModule {}
