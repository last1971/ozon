import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { SyliusModule } from '../sylius/sylius.module';
import { Trade2006ShowcaseService } from '../trade2006.showcase/trade2006.showcase.service';
import { SyliusShowcaseController } from './sylius.showcase.controller';
import { SyliusShowcaseService } from './sylius.showcase.service';

@Module({
    imports: [FirebirdModule, SyliusModule],
    providers: [Trade2006ShowcaseService, SyliusShowcaseService],
    controllers: [SyliusShowcaseController],
    exports: [SyliusShowcaseService],
})
export class SyliusShowcaseModule {}
