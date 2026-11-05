import { Module } from '@nestjs/common';
import { PostingModule } from '../posting/posting.module';
import { PostingFboModule } from '../posting.fbo/posting.fbo.module';
import { ProductModule } from '../product/product.module';
import { OzonCategoryModule } from '../ozon.category/ozon.category.module';
import { OzonRoutesService } from './ozon.routes.service';
import { OzonLogisticsService } from './ozon.logistics.service';

@Module({
    imports: [PostingModule, PostingFboModule, ProductModule, OzonCategoryModule],
    providers: [OzonRoutesService, OzonLogisticsService],
    exports: [OzonLogisticsService],
})
export class OzonLogisticsModule {}
