import { forwardRef, Module } from '@nestjs/common';
import { SyliusPriceService } from './sylius.price.service';
import { GoodModule } from '../good/good.module';
import { SyliusModule } from '../sylius/sylius.module';
import { SyliusShowcaseModule } from '../sylius.showcase/sylius.showcase.module';

@Module({
    imports: [forwardRef(() => GoodModule), SyliusModule, SyliusShowcaseModule],
    providers: [SyliusPriceService],
    exports: [SyliusPriceService],
})
export class SyliusPriceModule {}
