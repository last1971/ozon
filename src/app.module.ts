import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OzonApiModule } from './ozon.api/ozon.api.module';
import { ProductModule } from './product/product.module';
import { ElectronicaApiModule } from './electronica.api/electronica.api.module';
import { ScheduleModule } from '@nestjs/schedule';
import { GOOD_SERVICE } from './interfaces/IGood';
import { ElectronicaGoodService } from './electronica.good/electronica.good.service';
import { ElectronicaApiService } from './electronica.api/electronica.api.service';
import { Trade2006GoodService } from './trade2006.good/trade2006.good.service';
import { FIREBIRD, FirebirdModule } from './firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';
import { VaultModule } from 'vault-module/lib/vault.module';
import { PostingModule } from './posting/posting.module';
import { InvoiceModule } from './invoice/invoice.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
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
    ],
    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: GOOD_SERVICE,
            useFactory: (service: ElectronicaApiService, configService: ConfigService, dataBase: FirebirdDatabase) =>
                configService.get<string>('GOOD_PROVIDER', 'Trade2006') === 'Trade2006'
                    ? new Trade2006GoodService(dataBase)
                    : new ElectronicaGoodService(service),
            inject: [ElectronicaApiService, ConfigService, FIREBIRD],
        },
    ],
})
export class AppModule {}
