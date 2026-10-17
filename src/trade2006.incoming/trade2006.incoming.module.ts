import { Module } from '@nestjs/common';
import { Trade2006IncomingService } from './trade2006.incoming.service';
import { FirebirdModule } from '../firebird/firebird.module';
import { MpEventModule } from '../mp-event/mp-event.module';
import { PriceModule } from '../price/price.module';
import { Trade2006IncomingController } from './trade2006.incoming.controller';
import { IncomingStore } from './incoming.store';
import { LoadPendingIncomingCommand } from './commands/load-pending-incoming.command';
import { LoadIncomingGoodsCommand } from './commands/load-incoming-goods.command';
import { RepriceIncomingGoodsCommand } from './commands/reprice-incoming-goods.command';
import { MarkIncomingHandledCommand } from './commands/mark-incoming-handled.command';

@Module({
    imports: [FirebirdModule, MpEventModule, PriceModule],
    providers: [
        Trade2006IncomingService,
        IncomingStore,
        LoadPendingIncomingCommand,
        LoadIncomingGoodsCommand,
        RepriceIncomingGoodsCommand,
        MarkIncomingHandledCommand,
    ],
    exports: [Trade2006IncomingService],
    controllers: [Trade2006IncomingController],
})
export class Trade2006IncomingModule {}
