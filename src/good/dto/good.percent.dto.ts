import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, Min } from 'class-validator';
import { IOfferIdable } from '../../interfaces/IOfferIdable';

export class GoodPercentDto implements IOfferIdable {
    @ApiProperty({ description: 'Наш код товара' })
    @IsNotEmpty()
    offer_id: string;
    @ApiProperty({ description: 'Мин наценка', required: false })
    @IsOptional()
    @Min(1)
    min_perc?: number;
    @ApiProperty({ description: 'Наценка', required: false })
    @IsOptional()
    @Min(1)
    perc?: number;
    @ApiProperty({ description: 'Макс наценка', required: false })
    @IsOptional()
    @Min(1)
    old_perc?: number;
    @ApiProperty({ description: 'Процент на рекламу', required: false })
    @IsOptional()
    @Min(0)
    adv_perc?: number;
    pieces?: number;
}
