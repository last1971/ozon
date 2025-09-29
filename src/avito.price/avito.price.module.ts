import { forwardRef, Module } from '@nestjs/common';
import { AvitoPriceService } from './avito.price.service';
import { GoodModule } from '../good/good.module';
import { AvitoApiModule } from '../avito.api/avito.api.module';
import { AvitoCardModule } from '../avito.card/avito.card.module';

@Module({
    imports: [forwardRef(() => GoodModule), AvitoApiModule, forwardRef(() => AvitoCardModule)],
    providers: [AvitoPriceService],
    exports: [AvitoPriceService],
})
export class AvitoPriceModule {}