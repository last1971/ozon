import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    await app.listen(app.get(ConfigService).get<number>('APP_PORT', 3002));
}
bootstrap();
