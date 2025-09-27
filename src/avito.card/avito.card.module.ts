import { forwardRef, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AvitoCardService } from './avito.card.service';
import { AvitoApiModule } from '../avito.api/avito.api.module';
import { GoodModule } from '../good/good.module';

@Module({
    imports: [HttpModule, AvitoApiModule, forwardRef(() => GoodModule)],
    providers: [AvitoCardService],
    exports: [AvitoCardService],
})
export class AvitoCardModule {}
