import { Body, Controller, Inject, Param, Put } from "@nestjs/common";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { ApiBody, ApiExtraModels, ApiOkResponse, ApiParam, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { RemarkDto } from "./dto/remark.dto";
import { InvoiceUpdateDto } from "./dto/invoice.update.dto";
import { InvoiceDto } from "./dto/invoice.dto";
import { InvoiceLineDto } from "./dto/invoice.line.dto";

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
}
