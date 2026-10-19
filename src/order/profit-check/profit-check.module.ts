import { Module } from '@nestjs/common';
import { MpEventModule } from '../../mp-event/mp-event.module';
import { PriceModule } from '../../price/price.module';
import { GoodModule } from '../../good/good.module';
import { PostingModule } from '../../posting/posting.module';
import { WbOrderModule } from '../../wb.order/wb.order.module';
import { YandexOrderModule } from '../../yandex.order/yandex.order.module';
import { ProfitCheckService } from './profit-check.service';
import { SalePriceSources } from './sale-price.sources';
import { LoadPendingCommand } from './commands/load-pending.command';
import { ResolveSalePricesCommand } from './commands/resolve-sale-prices.command';
import { FallbackSalePricesCommand } from './commands/fallback-sale-prices.command';
import { LoadPriceContextCommand } from './commands/load-price-context.command';
import { EvaluateCommand } from './commands/evaluate.command';
import { NotifyCommand } from './commands/notify.command';
import { MarkHandledCommand } from './commands/mark-handled.command';

@Module({
    imports: [MpEventModule, PriceModule, GoodModule, PostingModule, WbOrderModule, YandexOrderModule],
    providers: [
        ProfitCheckService,
        SalePriceSources,
        LoadPendingCommand,
        ResolveSalePricesCommand,
        FallbackSalePricesCommand,
        LoadPriceContextCommand,
        EvaluateCommand,
        NotifyCommand,
        MarkHandledCommand,
    ],
})
export class ProfitCheckModule {}
