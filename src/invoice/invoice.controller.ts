import { Body, Controller, Inject, Param, Put, Post } from "@nestjs/common";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { ApiBody, ApiExtraModels, ApiOkResponse, ApiParam, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { RemarkDto } from "./dto/remark.dto";
import { InvoiceUpdateDto } from "./dto/invoice.update.dto";
import { InvoiceDto } from "./dto/invoice.dto";
import { InvoiceLineDto } from "./dto/invoice.line.dto";
import { ResultDto } from "../helpers/dto/result.dto";
import { DistributePaymentDto } from "./dto/distribute-payment.dto";

@ApiExtraModels(InvoiceDto, InvoiceLineDto)
@ApiTags("invoice")
@Controller('invoice')
export class InvoiceController {
    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
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
        return {
            isSuccess: await this.invoiceService.update(invoice, invoiceUpdateDto),
            invoice,
        };
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
