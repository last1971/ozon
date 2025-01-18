import { Module } from '@nestjs/common';
import { PromosService } from './promos.service';
import { PromosController } from './promos.controller';
import { OzonApiModule } from 'src/ozon.api/ozon.api.module';
import { ProductService } from 'src/product/product.service';

@Module({
    imports: [OzonApiModule],
    providers: [PromosService],
    controllers: [PromosController],
})
export class PromosModule {}
