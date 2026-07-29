import { BadRequestException, Body, Controller, Inject, Param, Post, Put } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { RemarkDto } from "../invoice/dto/remark.dto";
import { InvoiceUpdateDto } from "../invoice/dto/invoice.update.dto";
import { MarkScanFbsService } from "../invoice/mark-scan-fbs.service";
import { OrderService } from "../order/order.service";

@ApiTags("pickup")
@Controller('pickup')
export class PickupController {
    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private markScanService: MarkScanFbsService,
        private orderService: OrderService,
    ) {}

    @Post(':remark/marks')
    @ApiOperation({ summary: 'Передать КМ (+ГТД) маркетплейсу. Без сборки/ship.' })
    @ApiParam({ name: 'remark', description: 'Примечание = номер заказа', type: 'string' })
    @ApiOkResponse({ description: 'Результат передачи КМ: { submit }' })
    async submitMarks(@Param() remarkDto: RemarkDto): Promise<any> {
        const { invoice } = remarkDto;
        const ready = await this.markScanService.isReadyToFinish(invoice);
        if (!ready) {
            throw new BadRequestException('Не все КМ отсканированы');
        }
        const submit = await this.orderService.submitFbsMarkCodesForInvoice(invoice);
        return { submit };
    }

    @Put(':remark')
    @ApiParam({
        name: 'remark',
        description: 'Примечание = номер заказа',
        type: 'string',
    })
    @ApiBody({
        description: 'Данные сборки: START_PICKUP / FINISH_PICKUP / IGK',
        type: InvoiceUpdateDto,
    })
    @ApiOkResponse({
        description: 'Результат обновления счёта',
    })
    async update(@Param() remarkDto: RemarkDto, @Body() invoiceUpdateDto: InvoiceUpdateDto): Promise<any> {
        const { invoice } = remarkDto;
        if (invoiceUpdateDto.FINISH_PICKUP) {
            const ready = await this.markScanService.isReadyToFinish(invoice);
            if (!ready) {
                throw new BadRequestException('Не все КМ отсканированы');
            }
        }
        // FINISH_PICKUP только фиксирует IGK и время. Передача КМ — отдельный POST /marks.
        const isSuccess = await this.invoiceService.update(invoice, invoiceUpdateDto);
        return { isSuccess, invoice };
    }
}
