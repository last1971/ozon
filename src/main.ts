import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
    //TODO: remove cors for prod?
    const app = await NestFactory.create(AppModule, { cors: true });
    app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
    const config = new DocumentBuilder()
        .setTitle('Pricing example')
        .setDescription('The pricing API description')
        .setVersion('1.0')
        .addTag('ozon')
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
    await app.listen(app.get(ConfigService).get<number>('APP_PORT', 3002));
}
bootstrap();
