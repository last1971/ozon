import { IsNotEmpty, Validate } from 'class-validator';
import { IsRemarkValid } from "../../validators/is.remark.valid";
import { ApiProperty } from "@nestjs/swagger";
import { InvoiceDto } from "./invoice.dto";
import { InvoiceMatchDto } from "./invoice.match.dto";

export class RemarkDto {
    @ApiProperty({
        description: 'Примечание = номер заказа',
        type: 'string',
    })
    @IsNotEmpty({ message: 'Remark is required' })
    @Validate(IsRemarkValid) // Используем кастомный валидатор
    remark: string;

    invoice?: InvoiceDto;
    /** Пометка счёта (' отмена', ' отмена FBO', ' закрыт') — на неё смотрят гейты скана и подбора. */
    match?: InvoiceMatchDto;
}