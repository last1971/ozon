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
import { Trade2006GoodModule } from './trade2006.good/trade2006.good.module';
import { Trade2006GoodService } from './trade2006.good/trade2006.good.service';
import { FIREBIRD, FirebirdModule } from './firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ScheduleModule.forRoot(),
        OzonApiModule,
        ProductModule,
        ElectronicaApiModule,
        Trade2006GoodModule,
        FirebirdModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: GOOD_SERVICE,
            useFactory: (service: ElectronicaApiService, configService: ConfigService, dateBase: FirebirdDatabase) =>
                configService.get<string>('GOOD_PROVIDER', 'Trade2006') === 'Trade2006'
                    ? new Trade2006GoodService(dateBase)
                    : new ElectronicaGoodService(service),
            inject: [ElectronicaApiService, ConfigService, FIREBIRD],
        },
    ],
})
export class AppModule {}
