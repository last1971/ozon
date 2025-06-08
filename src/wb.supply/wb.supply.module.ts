import { Module } from '@nestjs/common';
import { WbSupplyService } from './wb.supply.service';
import { WbApiModule } from '../wb.api/wb.api.module';
import { WbOrderModule } from "../wb.order/wb.order.module";

@Module({
    imports: [WbApiModule, WbOrderModule],
    providers: [WbSupplyService],
    exports: [WbSupplyService],
})
export class WbSupplyModule {}
