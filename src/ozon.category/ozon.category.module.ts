import { JobModule } from '../job/job.module';
import { TariffImportService } from './import/tariff-import.service';
import { ReadTariffFileCommand } from './import/read-tariff-file.command';
import { ValidateTariffFileCommand } from './import/validate-tariff-file.command';
import { ParseTariffRowsCommand } from './import/parse-tariff-rows.command';
import { WriteTariffsCommand } from './import/write-tariffs.command';
import { SaveTariffDateCommand } from './import/save-tariff-date.command';
import { Module } from '@nestjs/common';
import { OzonTariffService } from './tariff.service';
import { NotifyModule } from '../notify/notify.module';
import { OzonCategoryService } from './ozon.category.service';
import { OzonCategoryController } from './ozon.category.controller';
import { FirebirdModule } from '../firebird/firebird.module';
import { ProductModule } from '../product/product.module';
import { AIModule } from '../ai/ai.module';
import { AIProductModule } from '../ai.product/ai.product.module';
import { GenerateNameCommand } from './commands/generate-name.command';
import { FindCategoryCommand } from './commands/find-category.command';
import { LoadRequiredAttributesCommand } from './commands/load-required-attributes.command';
import { GenerateAttributeValuesCommand } from './commands/generate-attribute-values.command';
import { ResolveDictionaryValuesCommand } from './commands/resolve-dictionary-values.command';
import { ExpandVariantsCommand } from './commands/expand-variants.command';
import { ResolvePackagingCommand } from './commands/resolve-packaging.command';
import { BuildProductJsonCommand } from './commands/build-product-json.command';
import { SubmitProductCommand } from './commands/submit-product.command';
import { ValidateOfferIdCommand } from './commands/validate-offer-id.command';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { ImageStorageModule } from '../image-storage/image-storage.module';

@Module({
    imports: [
        JobModule,
        NotifyModule,
        FirebirdModule,
        ProductModule,
        AIModule,
        AIProductModule,
        OzonApiModule,
        ImageStorageModule,
    ],
    providers: [
        OzonCategoryService,
        OzonTariffService,
        TariffImportService,
        ReadTariffFileCommand,
        ValidateTariffFileCommand,
        ParseTariffRowsCommand,
        WriteTariffsCommand,
        SaveTariffDateCommand,
        ValidateOfferIdCommand,
        GenerateNameCommand,
        FindCategoryCommand,
        LoadRequiredAttributesCommand,
        GenerateAttributeValuesCommand,
        ResolveDictionaryValuesCommand,
        ExpandVariantsCommand,
        ResolvePackagingCommand,
        BuildProductJsonCommand,
        SubmitProductCommand,
    ],
    controllers: [OzonCategoryController],
    exports: [OzonCategoryService, OzonTariffService],
})
export class OzonCategoryModule {}
