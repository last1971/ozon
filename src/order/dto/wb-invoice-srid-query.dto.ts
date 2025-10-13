import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString, IsNotEmpty } from 'class-validator';

export class WbInvoiceSridQueryDto {
    @ApiProperty({
        description: 'Дата начала периода для поиска транзакций (формат: YYYY-MM-DD)',
        example: '2025-09-21',
        type: String,
        required: true,
    })
    @IsNotEmpty({ message: 'Дата начала периода обязательна' })
    @IsDateString({}, { message: 'Неверный формат даты. Используйте YYYY-MM-DD' })
    dateFrom: string;

    @ApiProperty({
        description: 'SRID (уникальный идентификатор заказа Wildberries)',
        example: 'WB-GI-12345678',
        type: String,
        required: true,
    })
    @IsNotEmpty({ message: 'SRID обязателен' })
    @IsString({ message: 'SRID должен быть строкой' })
    srid: string;
}
