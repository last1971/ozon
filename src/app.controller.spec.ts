import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GOOD_SERVICE } from './interfaces/IGood';
import { INVOICE_SERVICE } from './interfaces/IInvoice';
import { ConfigService } from '@nestjs/config';
import { ProductService } from './product/product.service';

describe('AppController', () => {
    let appController: AppController;

    beforeEach(async () => {
        const app: TestingModule = await Test.createTestingModule({
            controllers: [AppController],
            providers: [
                AppService,
                { provide: GOOD_SERVICE, useValue: {} },
                { provide: INVOICE_SERVICE, useValue: {} },
                { provide: ConfigService, useValue: {} },
                { provide: ProductService, useValue: {} },
            ],
        }).compile();

        appController = app.get<AppController>(AppController);
    });

    describe('root', () => {
        it('should return "Hello World!"', () => {
            expect(appController.getHello()).toBe('Hello World!');
        });
    });
});
