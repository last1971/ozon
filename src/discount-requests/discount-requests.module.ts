import { Module } from '@nestjs/common';
import { DiscountRequestsService } from './discount-requests.service';
import { DiscountRequestsController } from './discount-requests.controller';
import { OzonApiModule } from '../ozon.api/ozon.api.module';
import { PriceModule } from '../price/price.module';

@Module({
    imports: [OzonApiModule, PriceModule],
    providers: [DiscountRequestsService],
    controllers: [DiscountRequestsController],
    exports: [DiscountRequestsService],
})
export class DiscountRequestsModule {} 