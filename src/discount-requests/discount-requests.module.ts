import { Module } from '@nestjs/common';
import { DiscountRequestsService } from './discount-requests.service';
import { OzonApiModule } from '../ozon.api/ozon.api.module';

@Module({
    imports: [OzonApiModule],
    providers: [DiscountRequestsService],
    exports: [DiscountRequestsService],
})
export class DiscountRequestsModule {} 