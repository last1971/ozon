import { Module } from '@nestjs/common';
import { LabelService } from './label.service';
import { LabelController } from './label.controller';

@Module({
  providers: [LabelService],
  controllers: [LabelController]
})
export class LabelModule {}
