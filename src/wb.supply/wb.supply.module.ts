import { Module } from '@nestjs/common';
import { WbSupplyService } from './wb.supply.service';
import { WbApiModule } from '../wb.api/wb.api.module';

@Module({
    imports: [WbApiModule],
    providers: [WbSupplyService],
    exports: [WbSupplyService],
})
export class WbSupplyModule {}
