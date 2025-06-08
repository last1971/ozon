import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PerformanceService } from './performance.service';
import { PerformanceController } from './performance.controller';
import { HelpersModule } from 'src/helpers/helpers.module';

@Module({
    imports: [HelpersModule, ConfigModule],
    providers: [PerformanceService],
    controllers: [PerformanceController],
    exports: [PerformanceService],
})
export class PerformanceModule {}
