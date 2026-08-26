import { Body, Controller, Delete, Get, Inject, Param, Post } from "@nestjs/common";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { ApiBody, ApiExtraModels, ApiOkResponse, ApiParam, ApiTags } from "@nestjs/swagger";
import { RemarkDto } from "./dto/remark.dto";
import { InvoiceDto } from "./dto/invoice.dto";
import { InvoiceLineDto } from "./dto/invoice.line.dto";
import { ResultDto } from "../helpers/dto/result.dto";
import { DistributePaymentDto } from "./dto/distribute-payment.dto";
import { MarkScanFbsService } from "./mark-scan-fbs.service";
import { MarkScanDto } from "./dto/mark-scan.dto";
import { MarkScanProgressDto } from "./dto/mark-scan-progress.dto";
import { MarkScanResultDto } from "./dto/mark-scan-result.dto";
import { InvoiceDonorsDto } from "./dto/invoice-donors.dto";

@ApiExtraModels(InvoiceDto, InvoiceLineDto)
@ApiTags("invoice")
@Controller('invoice')
export class InvoiceController {
    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private markScanService: MarkScanFbsService,
    ) {}

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
        // Гейт: счёт отменён → сообщение кладовщику и отвязка уже привязанных кодов,
        // вместо тихой привязки очередного КМ к мёртвому счёту.
        await this.markScanService.assertLive(remarkDto.match);
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

    @Get('donors/:posting')
    @ApiParam({ name: 'posting', type: 'string', description: 'Номер заказа — ищется подстрокой в примечании счёта' })
    @ApiOkResponse({ type: [InvoiceDonorsDto] })
    async donors(@Param('posting') posting: string): Promise<InvoiceDonorsDto[]> {
        return this.invoiceService.findDonorsByPrim(posting);
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
