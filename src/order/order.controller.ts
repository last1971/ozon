import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { OrderService } from './order.service';
import { ResultDto } from '../helpers/result.dto';
import { TransactionFilterDate, TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('order')
@Controller('order')
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
        description: 'Синхронизировать WB FBO заказы',
        type: ResultDto,
    })
    @Get('update-wbfbo')
    async updateWbFboOrder(): Promise<ResultDto> {
        await this.wbOrder.checkCanceledOrders();
        return { isSuccess: await this.wbOrder.addFboOrders() };
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

    @ApiConsumes('multipart/form-data')
    @ApiOkResponse({
        schema: {
            type: 'string',
            format: 'binary',
        },
    })
    @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                },
                from: {
                    type: 'date',
                },
                to: {
                    type: 'date',
                },
            },
        },
    })
    @UseInterceptors(FileInterceptor('file'))
    @Post('wb-transaction')
    async updateWbTransactions(
        @UploadedFile('file') file: Express.Multer.File,
        @Body() request: TransactionFilterDate,
    ): Promise<ResultDto> {
        return this.wbOrder.updateTransactions(request, file);
    }
}
