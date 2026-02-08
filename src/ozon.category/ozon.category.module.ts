import { Module } from '@nestjs/common';
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
import { BuildProductJsonCommand } from './commands/build-product-json.command';
import { SubmitProductCommand } from './commands/submit-product.command';
import { OzonApiModule } from '../ozon.api/ozon.api.module';

@Module({
    imports: [FirebirdModule, ProductModule, AIModule, AIProductModule, OzonApiModule],
    providers: [
        OzonCategoryService,
        GenerateNameCommand,
        FindCategoryCommand,
        LoadRequiredAttributesCommand,
        GenerateAttributeValuesCommand,
        ResolveDictionaryValuesCommand,
        BuildProductJsonCommand,
        SubmitProductCommand,
    ],
    controllers: [OzonCategoryController],
    exports: [OzonCategoryService],
})
export class OzonCategoryModule {}
