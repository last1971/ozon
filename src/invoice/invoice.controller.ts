import { BadRequestException, Body, Controller, Delete, forwardRef, Get, Inject, Logger, Param, Put, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import { OrderService } from "../order/order.service";
import { isMarkSubmittable, SubmitResultDto } from "../interfaces/IMarkSubmittable";

@ApiExtraModels(InvoiceDto, InvoiceLineDto)
@ApiTags("invoice")
@Controller('invoice')
export class InvoiceController {
    private readonly logger = new Logger(InvoiceController.name);

    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private markScanService: MarkScanFbsService,
        @Inject(forwardRef(() => OrderService)) private orderService: OrderService,
        private configService: ConfigService,
    ) {}

    private isMarkCodesEnabled(): boolean {
        const v = this.configService.get<boolean | string>('MARK_CODES_ENABLED', false);
        return v === true || v === 'true';
    }

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
                    $ref: getSchemaPath(InvoiceDto),
                },
                submit: {
                    type: 'object',
                    description: 'Результат передачи КМ маркетплейсу (опционально, только при FINISH_PICKUP)',
                    nullable: true,
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
        const isSuccess = await this.invoiceService.update(invoice, invoiceUpdateDto);
        let submit: SubmitResultDto | undefined;
        if (invoiceUpdateDto.FINISH_PICKUP && this.isMarkCodesEnabled()) {
            const service = this.orderService.getServiceByBuyerId(invoice.buyerId, true);
            if (isMarkSubmittable(service)) {
                try {
                    submit = await service.submitFbsMarkCodes(invoice);
                } catch (e) {
                    const message = e?.message ?? String(e);
                    this.logger.warn(`submitFbsMarkCodes failed for ${invoice.remark}: ${message}, cron retry`);
                    submit = { ok: false, failed: [{ ki: '*', reason: message }] };
                }
            }
        }
        return { isSuccess, invoice, submit };
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
