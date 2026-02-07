import { Module } from '@nestjs/common';
import { OzonCategoryService } from './ozon.category.service';
import { OzonCategoryController } from './ozon.category.controller';
import { FirebirdModule } from '../firebird/firebird.module';
import { ProductModule } from '../product/product.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [FirebirdModule, ProductModule, AIModule],
    providers: [OzonCategoryService],
    controllers: [OzonCategoryController],
    exports: [OzonCategoryService],
})
export class OzonCategoryModule {}
