import { Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';
import { ProductModule } from '../product/product.module';

@Module({
    imports: [ProductModule],
    providers: [PriceService],
    controllers: [PriceController],
})
export class PriceModule {}
