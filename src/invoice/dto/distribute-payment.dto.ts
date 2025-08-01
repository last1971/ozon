import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class DistributePaymentDto {
    @ApiProperty({
        description: 'Номер УПД',
        example: 1,
        type: 'number',
    })
    @IsNumber()
    @IsNotEmpty()
    updNumber: number;

    @ApiProperty({
        description: 'Дата УПД в формате YYYY-MM-DD',
        example: '2024-01-01',
        type: 'string',
    })
    @IsString()
    @IsNotEmpty()
    updDate: string;

    @ApiProperty({
        description: 'Сумма платежа для распределения',
        example: 1000.50,
        type: 'number',
    })
    @IsNumber()
    @IsNotEmpty()
    amount: number;
} 