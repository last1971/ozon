import { Module } from '@nestjs/common';
import { YandexApiService } from './yandex.api.service';
import { HttpModule } from '@nestjs/axios';

@Module({
    imports: [HttpModule],
    providers: [YandexApiService],
    exports: [YandexApiService],
})
export class YandexApiModule {}
