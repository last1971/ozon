import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { OzonApiModule } from './ozon.api/ozon.api.module';
import { ProductModule } from './product/product.module';
import { ElectronicaApiModule } from './electronica.api/electronica.api.module';
import { ScheduleModule } from '@nestjs/schedule';
import { GOOD_SERVICE } from './interfaces/IGood';
import { ElectronicaGoodService } from './electronica.good/electronica.good.service';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ScheduleModule.forRoot(),
        OzonApiModule,
        ProductModule,
        ElectronicaApiModule,
    ],
    controllers: [AppController],
    providers: [AppService, { provide: GOOD_SERVICE, useClass: ElectronicaGoodService }],
})
export class AppModule {}
