import { CheckLossPriceStockCommand } from './check-loss-price-stock.command';
import { MarketPriceWorkflowService } from './market-price-workflow.service';
import { Module, forwardRef } from '@nestjs/common';
import { MarketplaceLossModule } from '../marketplace-loss.module';
import { MpEventModule } from '../../mp-event/mp-event.module';
import { JobModule } from '../../job/job.module';
import { GoodModule } from '../../good/good.module';
import { PriceModule } from '../../price/price.module';
import { ProductModule } from '../../product/product.module';
import { WbPriceModule } from '../../wb.price/wb.price.module';
import { WbCurrentPricesModule } from '../../wb.price/wb.current-prices.module';
import { PromosModule } from '../../promos/promos.module';
import { OzonLossPriceAdapter } from './ozon-loss-price.adapter';
import { WbLossPriceAdapter } from './wb-loss-price.adapter';
import { LossPriceUpdateService } from './loss-price-update.service';
import { LossPriceQueueController } from './loss-price-queue.controller';
import { LOSS_PRICE_ADAPTERS } from './loss-price.contracts';
import {
    LoadLossPriceTasksCommand,
    CalculateLossPriceTargetsCommand,
    CompareLossPricesCommand,
    SendLossPricesCommand,
    ConfirmLossPricesCommand,
    CheckLossPricePromosCommand,
    FinishLossPriceTasksCommand,
} from './loss-price.commands';
@Module({
    imports: [
        MarketplaceLossModule,
        MpEventModule,
        JobModule,
        GoodModule,
        forwardRef(() => PriceModule),
        ProductModule,
        WbPriceModule,
        WbCurrentPricesModule,
        PromosModule,
    ],
    providers: [
        OzonLossPriceAdapter,
        WbLossPriceAdapter,
        LossPriceUpdateService,
        MarketPriceWorkflowService,
        CheckLossPriceStockCommand,
        LoadLossPriceTasksCommand,
        CalculateLossPriceTargetsCommand,
        CompareLossPricesCommand,
        SendLossPricesCommand,
        ConfirmLossPricesCommand,
        CheckLossPricePromosCommand,
        FinishLossPriceTasksCommand,
        {
            provide: LOSS_PRICE_ADAPTERS,
            inject: [OzonLossPriceAdapter, WbLossPriceAdapter],
            useFactory: (ozon: OzonLossPriceAdapter, wb: WbLossPriceAdapter) => ({ OZON: ozon, WB: wb }),
        },
    ],
    controllers: [LossPriceQueueController],
    exports: [LossPriceUpdateService, MarketPriceWorkflowService],
})
export class LossPriceUpdateModule {}
