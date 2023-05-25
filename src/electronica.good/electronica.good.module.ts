import { Module } from '@nestjs/common';
import { ElectronicaGoodService } from './electronica.good.service';
import { ElectronicaApiModule } from '../electronica.api/electronica.api.module';

@Module({
    imports: [ElectronicaApiModule],
    providers: [ElectronicaGoodService],
    exports: [ElectronicaGoodService],
})
export class ElectronicaGoodModule {}
