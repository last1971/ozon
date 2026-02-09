import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AIProductService } from './ai.product.service';
import { AIProductController } from './ai.product.controller';

@Module({
    imports: [AIModule],
    controllers: [AIProductController],
    providers: [AIProductService],
    exports: [AIProductService],
})
export class AIProductModule {}
