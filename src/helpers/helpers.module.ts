import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PriceCalculationHelper } from './price/price.calculation.helper';
import { HttpWrapperService } from './http/http-wrapper.service';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [ConfigModule, HttpModule],
    providers: [
        PriceCalculationHelper,
        HttpWrapperService,
    ],
    exports: [
        PriceCalculationHelper,
        HttpWrapperService,
    ]
})
export class HelpersModule {}