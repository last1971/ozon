import { Module } from '@nestjs/common';
import { HelpersModule } from '../helpers/helpers.module';
import { SyliusPriceModule } from '../sylius.price/sylius.price.module';
import { SupplierPriceController } from './supplier.price.controller';
import { SupplierPriceService } from './supplier.price.service';
import { SupplierPriceStrategyRegistry } from './supplier.price.strategy.registry';
import { DefaultMarkup } from './strategies/default.markup';
import { CompelMarkup } from './strategies/compel.markup';
import { RuelectronicsMarkup } from './strategies/ruelectronics.markup';
import { ValidateBatchCommand } from './commands/validate-batch.command';
import { ConvertCurrencyCommand } from './commands/convert-currency.command';
import { AddDeliveryCommand } from './commands/add-delivery.command';
import { ApplyMarkupCommand } from './commands/apply-markup.command';
import { BuildResponseCommand } from './commands/build-response.command';

@Module({
    imports: [HelpersModule, SyliusPriceModule],
    controllers: [SupplierPriceController],
    providers: [
        SupplierPriceService,
        SupplierPriceStrategyRegistry,
        DefaultMarkup,
        CompelMarkup,
        RuelectronicsMarkup,
        ValidateBatchCommand,
        ConvertCurrencyCommand,
        AddDeliveryCommand,
        ApplyMarkupCommand,
        BuildResponseCommand,
    ],
    exports: [SupplierPriceService],
})
export class SupplierPriceModule {}
