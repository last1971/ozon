import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AvitoCardService } from './avito.card.service';
import { AvitoApiModule } from '../avito.api/avito.api.module';

@Module({
    imports: [HttpModule, AvitoApiModule],
    providers: [AvitoCardService],
    exports: [AvitoCardService],
})
export class AvitoCardModule {}
