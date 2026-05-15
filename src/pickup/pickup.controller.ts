import { BadRequestException, Body, Controller, Inject, Param, Put } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiParam, ApiTags } from "@nestjs/swagger";
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
        description: 'Результат обновления и (опционально) передачи КМ',
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
        const submit = invoiceUpdateDto.FINISH_PICKUP
            ? await this.orderService.submitFbsMarkCodesForInvoice(invoice)
            : undefined;
        return { isSuccess, invoice, submit };
    }
}
