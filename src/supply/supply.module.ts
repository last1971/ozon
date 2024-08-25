import { Module } from '@nestjs/common';
import { SupplyController } from './supply.controller';
import { WbSupplyModule } from '../wb.supply/wb.supply.module';

@Module({
    imports: [WbSupplyModule],
    controllers: [SupplyController],
})
export class SupplyModule {}
