import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { useContainer } from "class-validator";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.useGlobalPipes(new ValidationPipe({ transform: true })); //, transformOptions: { enableImplicitConversion: true }
    app.enableCors();
    app.setGlobalPrefix('api');
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    const config = new DocumentBuilder()
        .setTitle('Ozon example')
        .setDescription('The Ozon API description')
        .setVersion('1.0')
        .addTag('ozon')
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    await app.listen(app.get(ConfigService).get<number>('APP_PORT', 3002));
}
bootstrap();
