import { Module } from '@nestjs/common';
import { WbCardService } from './wb.card.service';
import { WbApiModule } from '../wb.api/wb.api.module';

@Module({
    imports: [WbApiModule],
    providers: [WbCardService],
    exports: [WbCardService],
})
export class WbCardModule {}
