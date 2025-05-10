import {
    Body,
    Controller,
    Get,
    Param,
    ParseEnumPipe,
    ParseIntPipe,
    Post,
    UploadedFile,
    UseInterceptors
} from "@nestjs/common";
import { OrderService } from './order.service';
import { ResultDto } from '../helpers/dto/result.dto';
import { TransactionFilterDate, TransactionFilterDto } from '../posting/dto/transaction.filter.dto';
import {
    ApiBody,
    ApiConsumes,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiProduces,
    ApiTags,
    getSchemaPath
} from "@nestjs/swagger";
import { YandexOrderService } from '../yandex.order/yandex.order.service';
import { WbOrderService } from '../wb.order/wb.order.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { GoodServiceEnum } from "../good/good.service.enum";
import { PostingDto } from "../posting/dto/posting.dto";

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

    @ApiOkResponse({
        description: 'Заказы ожидающие сборки',
        type: PostingDto,
        isArray: true, // указывает, что возвращается массив объектов
    })
    @Get('awaiting-packaging/:service')
    async getAwaitingPackaging(@Param('service', new ParseEnumPipe(GoodServiceEnum)) service: GoodServiceEnum): Promise<PostingDto[]> {
        return this.orderService.getServiceByName(service).listAwaitingPackaging();
    }

    @Get(':buyerId/:postingNumber')
    @ApiOperation({ summary: 'Получить информацию о составе заказа по его номеру и id покупателя' })
    @ApiParam({
        name: 'buyerId',
        description: 'Идентификатор покупателя, должен быть числовым значением',
        type: 'number',
    })
    @ApiParam({
        name: 'postingNumber',
        description: 'Номер размещения заказа',
        type: 'string',
    })
    @ApiOkResponse({
        description: 'Данные размещения заказа',
        schema: {
            oneOf: [
                { $ref: getSchemaPath(PostingDto) }, // Используем описание из PostingDto для успешного ответа
                { type: 'null' }, // Ответ может быть null
            ],
        },
    })
    async getByPostingNumber(
        @Param('buyerId', ParseIntPipe) buyerId: number,
        @Param('postingNumber') postingNumber: string
    ): Promise<PostingDto | null> {
        return this.orderService.getByPostingNumber(postingNumber, buyerId);
    }

    @Get(':fboNumber')
    @ApiOperation({ summary: 'Получить информацию о составе заказа по его номеру' })
    @ApiParam({
        name: 'fboNumber',
        description: 'Номер FBO заказа',
        type: 'string',
    })
    @ApiOkResponse({
        description: 'Данные размещения заказа',
        schema: {
            oneOf: [
                { $ref: getSchemaPath(PostingDto) }, // Используем описание из PostingDto для успешного ответа
                { type: 'null' }, // Ответ может быть null
            ],
        },
    })
    async getByFboNumber(
        @Param('fboNumber') fboNumber: string
    ): Promise<PostingDto | null> {
        return this.orderService.getByFboNumber(fboNumber);
    }
}
