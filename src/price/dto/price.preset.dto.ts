import { ApiProperty } from '@nestjs/swagger';

export class PricePresetDto {
    @ApiProperty({ description: '% Мин наценка' })
    perc_min: number;
    @ApiProperty({ description: '% наценка' })
    perc_nor: number;
    @ApiProperty({ description: '% Макс наценка' })
    perc_max: number;
    @ApiProperty({ description: '% эквайринг' })
    perc_ekv: number;
    @ApiProperty({ description: '% доставка  до базы' })
    perc_mil: number;
    @ApiProperty({ description: 'минимальная доставка до базы' })
    min_mil: number;
    @ApiProperty({ description: 'сумма за обработку' })
    sum_obtain: number;
    @ApiProperty({ description: 'сумма за упаковку' })
    sum_pack: number;
    @ApiProperty({ description: 'сумма за этикетку' })
    sum_label: number;
    @ApiProperty({ description: 'налог' })
    tax_unit: number;
}
