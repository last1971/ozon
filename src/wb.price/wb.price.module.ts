import { Module } from '@nestjs/common';
import { WbPriceService } from './wb.price.service';
import { GoodModule } from '../good/good.module';
import { WbApiModule } from '../wb.api/wb.api.module';
import { WbCardModule } from '../wb.card/wb.card.module';
import { WbCurrentPricesModule } from './wb.current-prices.module';

@Module({
    imports: [GoodModule, WbApiModule, WbCardModule, WbCurrentPricesModule],
    providers: [WbPriceService],
    exports: [WbPriceService],
})
export class WbPriceModule {}
