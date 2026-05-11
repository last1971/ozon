import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Put, Post } from "@nestjs/common";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { ApiBody, ApiExtraModels, ApiOkResponse, ApiParam, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { RemarkDto } from "./dto/remark.dto";
import { InvoiceUpdateDto } from "./dto/invoice.update.dto";
import { InvoiceDto } from "./dto/invoice.dto";
import { InvoiceLineDto } from "./dto/invoice.line.dto";
import { ResultDto } from "../helpers/dto/result.dto";
import { DistributePaymentDto } from "./dto/distribute-payment.dto";
import { MarkScanFbsService } from "./mark-scan-fbs.service";
import { MarkScanDto } from "./dto/mark-scan.dto";
import { MarkScanProgressDto } from "./dto/mark-scan-progress.dto";
import { MarkScanResultDto } from "./dto/mark-scan-result.dto";

@ApiExtraModels(InvoiceDto, InvoiceLineDto)
@ApiTags("invoice")
@Controller('invoice')
export class InvoiceController {
    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private markScanService: MarkScanFbsService,
    ) {}

    @Put('update/:remark')
    @ApiParam({
        name: 'remark',
        description: 'Примечание = номер заказа',
        type: 'string',
    })
    @ApiBody({
        description: 'Данные для обновления счета',
        type: InvoiceUpdateDto,
    })
    @ApiOkResponse({
        description: 'Результат обновления счета',
        schema: {
            type: 'object',
            properties: {
                isSuccess: {
                    type: 'boolean',
                    description: 'Результат операции',
                },
                invoice: {
                    $ref: getSchemaPath(InvoiceDto), // Используем описание из InvoiceDto
                },
            },
        },
    })
    async update(@Param() remarkDto: RemarkDto, @Body() invoiceUpdateDto: InvoiceUpdateDto): Promise<any> {
        const { invoice } = remarkDto;
        if (invoiceUpdateDto.FINISH_PICKUP) {
            const ready = await this.markScanService.isReadyToFinish(invoice);
            if (!ready) {
                throw new BadRequestException('Не все КМ отсканированы');
            }
        }
        return {
            isSuccess: await this.invoiceService.update(invoice, invoiceUpdateDto),
            invoice,
        };
    }

    @Get(':remark/markcode/progress')
    @ApiParam({ name: 'remark', type: 'string' })
    @ApiOkResponse({ type: MarkScanProgressDto })
    async markcodeProgress(@Param() remarkDto: RemarkDto): Promise<MarkScanProgressDto> {
        return this.markScanService.getProgress(remarkDto.invoice);
    }

    @Post(':remark/markcode')
    @ApiParam({ name: 'remark', type: 'string' })
    @ApiBody({ type: MarkScanDto })
    @ApiOkResponse({ type: MarkScanResultDto })
    async markcodeScan(
        @Param() remarkDto: RemarkDto,
        @Body() body: MarkScanDto,
    ): Promise<MarkScanResultDto> {
        return this.markScanService.scan(remarkDto.invoice, body.ki);
    }

    @Delete(':remark/markcode/:ki')
    @ApiParam({ name: 'remark', type: 'string' })
    @ApiParam({ name: 'ki', type: 'string' })
    @ApiOkResponse({ type: MarkScanProgressDto })
    async markcodeUnscan(
        @Param() remarkDto: RemarkDto,
        @Param('ki') ki: string,
    ): Promise<MarkScanProgressDto> {
        return this.markScanService.unscan(remarkDto.invoice, ki);
    }

    @Post('distribute-payment')
    @ApiBody({
        description: 'Данные для распределения платежа по УПД',
        type: DistributePaymentDto,
    })
    @ApiOkResponse({
        description: 'Результат распределения платежа',
        type: ResultDto,
    })
    async distributePayment(@Body() distributePaymentDto: DistributePaymentDto): Promise<ResultDto> {
        const { updNumber, updDate, amount } = distributePaymentDto;
        
        return await this.invoiceService.distributePaymentByUPD(updNumber, updDate, amount);
    }
}
