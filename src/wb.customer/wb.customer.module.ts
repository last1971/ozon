import { Module } from '@nestjs/common';
import { WbCustomerService } from './wb.customer.service';
import { WbApiModule } from '../wb.api/wb.api.module';

@Module({
    imports: [WbApiModule],
    providers: [WbCustomerService],
    exports: [WbCustomerService],
})
export class WbCustomerModule {}
