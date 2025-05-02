import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PriceCalculationHelper } from './price/price.calculation.helper';
// import { GoodBoundaryHelper } from './boundary/good.boundary.helper';
// import { WildberriesDataHelper } from './wildberries/wildberries.data.helper';
// import { ServicePriceUpdateHelper } from './service/service.price.update.helper';

@Module({
    imports: [ConfigModule],
    providers: [
        PriceCalculationHelper,
//        GoodBoundaryHelper,
//        WildberriesDataHelper,
//        ServicePriceUpdateHelper
    ],
    exports: [
        PriceCalculationHelper,
//        GoodBoundaryHelper,
//        WildberriesDataHelper,
//        ServicePriceUpdateHelper
    ]
})
export class HelpersModule {}