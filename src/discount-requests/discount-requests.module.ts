import { Module, forwardRef } from '@nestjs/common';
import { DiscountRequestsService } from './discount-requests.service';
import { DiscountRequestsController } from './discount-requests.controller';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { PriceModule } from '../price/price.module';
import { GetDiscountTasksCommand } from './commands/get-discount-tasks.command';
import { ExtractOriginalOfferIdsCommand } from './commands/extract-original-offer-ids.command';
import { HandleDiscountsCommand } from './commands/handle-discounts.command';
import { GetPricesMapCommand } from './commands/get-prices-map.command';
import { MakeDecisionsCommand } from './commands/make-decisions.command';
import { ApproveDiscountTasksCommand } from './commands/approve-discount-tasks.command';
import { DeclineDiscountTasksCommand } from './commands/decline-discount-tasks.command';
import { EarlyExitCheckCommand } from './commands/early-exit-check.command';
import { LogResultCommand } from './commands/log-result.command';

@Module({
    imports: [OzonApiModule, PriceModule],
    providers: [
        DiscountRequestsService,
        GetDiscountTasksCommand,
        ExtractOriginalOfferIdsCommand,
        HandleDiscountsCommand,
        GetPricesMapCommand,
        MakeDecisionsCommand,
        ApproveDiscountTasksCommand,
        DeclineDiscountTasksCommand,
        EarlyExitCheckCommand,
        LogResultCommand,
    ],
    controllers: [DiscountRequestsController],
    exports: [
        DiscountRequestsService,
        GetDiscountTasksCommand,
        ExtractOriginalOfferIdsCommand,
        HandleDiscountsCommand,
        GetPricesMapCommand,
        MakeDecisionsCommand,
        ApproveDiscountTasksCommand,
        DeclineDiscountTasksCommand,
        EarlyExitCheckCommand,
        LogResultCommand,
    ],
})
export class DiscountRequestsModule {} 