import { Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { ProductModule } from '../product/product.module';
import { GoodModule } from '../good/good.module';
import { YandexPriceModule } from '../yandex.price/yandex.price.module';
import { WbPriceModule } from '../wb.price/wb.price.module';
import { AvitoPriceModule } from '../avito.price/avito.price.module';
import { ExtraPriceService } from "./extra.price.service";
import { ResetAvailablePriceCommand } from './commands/reset-available-price.command';
import { TradeSkusCommand } from './commands/trade-skus.command';
import { UpdatePercentsForGoodSkusCommand } from './commands/update-percents-for-good-skus.command';
import { GetAllOzonSkusCommand } from './commands/get-all-ozon-skus.command';
import { OzonSkusToTradeSkusCommand } from './commands/ozon-skus-to-trade-skus.command';
import { UpdatePriceForGoodSkusCommand } from './commands/update-price-for-good-skus.command';
import { CheckPriceDifferenceAndNotifyCommand } from './commands/check-price-difference-and-notify.command';
import { EmitUpdatePromosCommand } from './commands/emit-update-promos.command';
import { LogResultProcessingMessageCommand } from './commands/log-result-processing-message.command';
import { ValidateSkusNotEmptyCommand } from './commands/validate-skus-not-empty.command';
import { SetResultProcessingMessageCommand } from './commands/set-result-processing-message.command';

@Module({
    imports: [ProductModule, GoodModule, YandexPriceModule, WbPriceModule, AvitoPriceModule],
    providers: [
        PriceService,
        ExtraPriceService,
        ResetAvailablePriceCommand,
        TradeSkusCommand,
        UpdatePercentsForGoodSkusCommand,
        GetAllOzonSkusCommand,
        OzonSkusToTradeSkusCommand,
        UpdatePriceForGoodSkusCommand,
        CheckPriceDifferenceAndNotifyCommand,
        EmitUpdatePromosCommand,
        LogResultProcessingMessageCommand,
        ValidateSkusNotEmptyCommand,
        SetResultProcessingMessageCommand,
    ],
    controllers: [PriceController],
    exports: [
        PriceService,
        ExtraPriceService,
        ResetAvailablePriceCommand,
        TradeSkusCommand,
        UpdatePercentsForGoodSkusCommand,
        GetAllOzonSkusCommand,
        OzonSkusToTradeSkusCommand,
        UpdatePriceForGoodSkusCommand,
        CheckPriceDifferenceAndNotifyCommand,
        EmitUpdatePromosCommand,
        LogResultProcessingMessageCommand,
        ValidateSkusNotEmptyCommand,
        SetResultProcessingMessageCommand,
    ],
})
export class PriceModule {}
