import { Body, Controller, Inject, Param, Put } from "@nestjs/common";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";
import { ApiTags } from "@nestjs/swagger";
import { RemarkDto } from "./dto/remark.dto";
import { InvoiceUpdateDto } from "./dto/invoice.update.dto";

@ApiTags("invoice")
@Controller('invoice')
export class InvoiceController {
    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
    ) {}

    @Put('update/:remark')
    async update(@Param() remarkDto: RemarkDto, @Body() invoiceUpdateDto: InvoiceUpdateDto): Promise<boolean> {
        const { invoice } = remarkDto;
        console.log(invoice);
        return this.invoiceService.update(invoice, invoiceUpdateDto);
    }
}
