import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ProductCodeUpdateStockDto } from './product/dto/product.code.dto';

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get()
    getHello(): string {
        return this.appService.getHello();
    }

    @Get('update-count')
    updateCount(): Promise<ProductCodeUpdateStockDto[]> {
        return this.appService.checkGoodCount();
    }

    @Get('update-order')
    updateOrder(): Promise<void> {
        return this.appService.checkNewOrders();
    }
}
