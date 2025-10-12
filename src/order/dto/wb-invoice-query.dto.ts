import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString, IsNotEmpty } from 'class-validator';

export class WbInvoiceQueryDto {
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
        description: 'Номер стикера Wildberries',
        example: '42197484529',
        type: String,
        required: true,
    })
    @IsNotEmpty({ message: 'Номер стикера обязателен' })
    @IsString({ message: 'Номер стикера должен быть строкой' })
    stickerId: string;
}
