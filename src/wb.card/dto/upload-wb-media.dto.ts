import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class UploadWbMediaDto {
    @ApiProperty({ description: 'Артикул товара в Ozon (offer_id)' })
    @IsNotEmpty()
    @IsString()
    offerId: string;

    @ApiProperty({ description: 'nmId карточки WB' })
    @IsNotEmpty()
    @IsNumber()
    nmId: number;
}
