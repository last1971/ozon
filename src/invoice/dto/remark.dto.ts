import { IsNotEmpty, Validate } from 'class-validator';
import { IsRemarkValid } from "../../validators/is.remark.valid";
import { ApiProperty } from "@nestjs/swagger";
import { InvoiceDto } from "./invoice.dto";

export class RemarkDto {
    @ApiProperty({
        description: 'Примечание = номер заказа',
        type: 'string',
    })
    @IsNotEmpty({ message: 'Remark is required' })
    @Validate(IsRemarkValid) // Используем кастомный валидатор
    remark: string;

    invoice?: InvoiceDto;
}