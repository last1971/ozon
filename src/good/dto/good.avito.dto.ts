import { ApiProperty } from '@nestjs/swagger';

export class GoodAvitoDto {
    @ApiProperty({
        description: 'ID товара в Avito',
        example: 'avito123456',
        maxLength: 20,
    })
    id: string;

    @ApiProperty({
        description: 'Код товара в системе',
        example: '12345',
    })
    goodsCode: string;

    @ApiProperty({
        description: 'Коэффициент товара',
        example: 2,
        type: 'integer',
    })
    coeff: number;

    @ApiProperty({
        description: 'Комиссия Avito в процентах',
        example: 15.5,
        type: 'number',
        format: 'float',
    })
    commission: number;
}
