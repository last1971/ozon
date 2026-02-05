import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AIService } from './ai.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { YandexProvider } from './providers/yandex.provider';

@Module({
    imports: [HttpModule],
    providers: [AIService, AnthropicProvider, OpenAIProvider, YandexProvider],
    exports: [AIService],
})
export class AIModule {}
