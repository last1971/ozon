import { Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { ProductModule } from '../product/product.module';
import { GoodModule } from '../good/good.module';

@Module({
    imports: [ProductModule, GoodModule],
    providers: [PriceService],
    controllers: [PriceController],
})
export class PriceModule {}
