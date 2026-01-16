import { forwardRef, Module } from '@nestjs/common';
import { SyliusPriceService } from './sylius.price.service';
import { GoodModule } from '../good/good.module';
import { SyliusModule } from '../sylius/sylius.module';

@Module({
    imports: [forwardRef(() => GoodModule), SyliusModule],
    providers: [SyliusPriceService],
    exports: [SyliusPriceService],
})
export class SyliusPriceModule {}
