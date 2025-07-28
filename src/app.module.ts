import { Logger, Module } from "@nestjs/common";
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
import { CacheStore } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { WbSupplyModule } from './wb.supply/wb.supply.module';
import { SupplyModule } from './supply/supply.module';
import { LabelModule } from './label/label.module';
import { PromosModule } from './promos/promos.module';
import { Trade2006IncomingModule } from "./trade2006.incoming/trade2006.incoming.module";
import { HttpModule } from '@nestjs/axios';
import { HelpersModule } from "./helpers/helpers.module";
import { PerformanceModule } from "./performance/performance.module";
import { DiscountRequestsModule } from './discount-requests/discount-requests.module';
import JSONbig from 'json-bigint';

@Module({
    imports: [
        EventEmitterModule.forRoot(),
        ConfigModule.forRoot({ isGlobal: true, validate: configValidate }),
        CacheModule.registerAsync({
            isGlobal: true,
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => {
               const store = await redisStore({
                 socket: {
                   host: configService.get<string>('REDIS_HOST', 'localhost'),
                   port: configService.get<number>('REDIS_PORT', 6379),
                 },
                 // Убираем TTL - кэш будет храниться навсегда
               });
              return {
                store: store as unknown as CacheStore,
              };
            },
            inject: [ConfigService],
          }),
        HttpModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => {
                const isDebugging = process.env.NODE_ENV !== 'production';
                const debugTimeout = configService.get<number>('HTTP_DEBUG_TIMEOUT', 300000);
                const productionTimeout = configService.get<number>('HTTP_TIMEOUT', 60000);
                const defaultTimeout = isDebugging ? debugTimeout : productionTimeout;
                const logger = new Logger('HttpModule');
                logger.log(`HttpModule registered with default timeout: ${defaultTimeout}ms`);
                return {
                    timeout: defaultTimeout,
                    transformResponse: [(data) => {
                        try {
                          return JSONbig({ storeAsString: true }).parse(data);
                        } catch {
                          return data;
                        }
                      }],
                };
            },
            inject: [ConfigService],
        }),
        ServeStaticModule.forRoot({
            //rootPath: join(__dirname, '..', 'admin-panel/dist'),
            rootPath: join(process.cwd(), 'admin-panel/dist'),
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
        LabelModule,
        PromosModule,
        Trade2006IncomingModule,
        HelpersModule,
        PerformanceModule,
        DiscountRequestsModule,
    ],
    controllers: [AppController],
    providers: [AppService, CronSetupProviderService],
})
export class AppModule {}
