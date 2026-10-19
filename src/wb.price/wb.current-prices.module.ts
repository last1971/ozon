import { Module } from '@nestjs/common';
import { WbApiModule } from '../wb.api/wb.api.module';
import { WbCurrentPricesService } from './wb.current-prices.service';

/** Текущие цены кабинета ВБ — отдельным модулем, чтобы его брали и цены, и заказы без взаимных зависимостей. */
@Module({
    imports: [WbApiModule],
    providers: [WbCurrentPricesService],
    exports: [WbCurrentPricesService],
})
export class WbCurrentPricesModule {}
