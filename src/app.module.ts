import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OzonApiModule } from './ozon.api/ozon.api.module';
import { ProductModule } from './product/product.module';
import { ElectronicaApiModule } from './electronica.api/electronica.api.module';
import { ScheduleModule } from '@nestjs/schedule';
import { FirebirdModule } from './firebird/firebird.module';
import { VaultModule } from 'vault-module/lib/vault.module';
import { PostingModule } from './posting/posting.module';
import { InvoiceModule } from './invoice/invoice.module';
import { PriceModule } from './price/price.module';
import { GoodModule } from './good/good.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { OrderModule } from './order/order.module';
import { configValidate } from './env.validation';
import { CronSetupProviderService } from './cron.setup.provider/cron.setup.provider.service';
import { YandexApiModule } from './yandex.api/yandex.api.module';
import { YandexOfferModule } from './yandex.offer/yandex.offer.module';
import { YandexOrderModule } from './yandex.order/yandex.order.module';
import { YandexPriceModule } from './yandex.price/yandex.price.module';
import { PostingFboModule } from './posting.fbo/posting.fbo.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WbCardModule } from './wb.card/wb.card.module';
import { WbApiModule } from './wb.api/wb.api.module';
import { WbOrderModule } from './wb.order/wb.order.module';
import { WbPriceModule } from './wb.price/wb.price.module';
import { MailModule } from './mail/mail.module';
import { CacheModule } from '@nestjs/cache-manager';
import { WbSupplyModule } from './wb.supply/wb.supply.module';
import { SupplyModule } from './supply/supply.module';
@Module({
    imports: [
        CacheModule.register({
            isGlobal: true,
        }),
        EventEmitterModule.forRoot(),
        ConfigModule.forRoot({ isGlobal: true, validate: configValidate }),
        ServeStaticModule.forRoot({
            // serveRoot: 'admin',
            rootPath: join(__dirname, '..', 'admin-panel/dist'),
            // renderPath: 'dist/admin-panel/*',
        }),
        ScheduleModule.forRoot(),
        OzonApiModule,
        ProductModule,
        ElectronicaApiModule,
        FirebirdModule,
        VaultModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                credentials: {
                    user: configService.get('VAULT_USER'),
                    password: configService.get('VAULT_PASS'),
                },
                config: {
                    https: true,
                    baseUrl: configService.get('VAULT_URL'),
                    rootPath: configService.get('VAULT_ROOT'),
                    timeout: 2000,
                    proxy: false,
                },
            }),
            inject: [ConfigService],
        }),
        PostingModule,
        InvoiceModule,
        PriceModule,
        GoodModule,
        OrderModule,
        YandexApiModule,
        YandexOfferModule,
        YandexOrderModule,
        YandexPriceModule,
        PostingFboModule,
        WbCardModule,
        WbApiModule,
        WbOrderModule,
        WbPriceModule,
        MailModule,
        WbSupplyModule,
        SupplyModule,
    ],
    controllers: [AppController],
    providers: [AppService, CronSetupProviderService],
})
export class AppModule {}
