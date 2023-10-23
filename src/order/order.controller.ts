import { Body, Controller, Get, Post } from '@nestjs/common';
import { OrderService } from './order.service';
import { ResultDto } from '../helpers/result.dto';
import { TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { WbOrderService } from '../wb.order/wb.order.service';

@ApiTags('order')
@Controller('api/order')
export class OrderController {
    constructor(
        private readonly orderService: OrderService,
        private yandexOrderService: YandexOrderService,
        private wbOrder: WbOrderService,
    ) {}
    @ApiOkResponse({
        description: 'Синхронизировать заказы',
        type: ResultDto,
    })
    @Get('update')
    async updateOrder(): Promise<ResultDto> {
        await this.orderService.checkNewOrders();
        return { isSuccess: true };
    }
    @ApiOkResponse({
        description: 'Обновить оплаты и закрыть счета',
        type: ResultDto,
    })
    @Post('transactions')
    async updateTransactions(@Body() request: TransactionFilterDto): Promise<ResultDto> {
        return this.orderService.updateTransactions(request);
    }
    @Post('yandex-transaction')
    async updateYandexTransactions(): Promise<ResultDto> {
        return this.yandexOrderService.updateTransactions();
    }
    @Post('wb-transaction')
    async updateWbTransactions(@Body() request: TransactionFilterDto): Promise<ResultDto> {
        return this.wbOrder.updateTransactions(request);
    }
}
