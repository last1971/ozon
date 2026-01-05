import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SyliusApiService } from './sylius.api.service';
import { SyliusProductService } from './sylius.product.service';

@Module({
    imports: [HttpModule],
    providers: [SyliusApiService, SyliusProductService],
    exports: [SyliusApiService, SyliusProductService],
})
export class SyliusModule {}
