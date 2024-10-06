import { IsOptional, IsNotEmpty, IsDateString } from 'class-validator';
import { ApiProperty } from "@nestjs/swagger";
export class InvoiceUpdateDto {
    @ApiProperty({
        description: 'Номер заказа в Маркетплейсе(Примечание в Счете)',
        type: 'string',
    })
    @IsOptional() // Поле не обязательно, но если оно есть, будет валидироваться
    @IsNotEmpty({ message: 'IGK не должно быть пустым' }) // Проверка, что не пустая строка
    IGK?: string;

    @ApiProperty({
        description: 'Время начала сборки',
        type: 'string',
        format: 'date-time',
    })
    @IsOptional()
    @IsDateString({}, { message: 'START_PICKUP должно быть корректной датой в формате ISO' }) // Валидация даты и времени
    START_PICKUP?: string;

    @ApiProperty({
        description: 'Время окончания сборки',
        type: 'string',
        format: 'date-time',
    })
    @IsOptional()
    @IsDateString({}, { message: 'FINISH_PICKUP должно быть корректной датой в формате ISO' }) // Валидация даты и времени
    FINISH_PICKUP?: string;
}