import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsNumberString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum AutoAction {
    ENABLED = 'ENABLED',
    DISABLED = 'DISABLED',
    UNKNOWN = 'UNKNOWN',
}

export class UpdatePriceDto {
    @ApiProperty({
        description: 'Атрибут для включения и выключения автоприменения акций',
        enum: AutoAction,
        default: AutoAction.UNKNOWN,
        required: false,
    })
    @IsOptional()
    @IsEnum(AutoAction)
    auto_action_enabled? = AutoAction.UNKNOWN;
    currency_code = 'RUB';
    @ApiProperty({
        description: 'Атрибут для включения и выключения автоприменения стратегий цены',
        enum: AutoAction,
        default: AutoAction.UNKNOWN,
        required: false,
    })
    @IsOptional()
    @IsEnum(AutoAction)
    price_strategy_enabled? = AutoAction.UNKNOWN;
    @ApiProperty({
        description: 'Минимальная цена товара после применения акций',
        required: true,
    })
    @IsNotEmpty()
    @IsNumberString()
    min_price?: string;
    @ApiProperty({
        description: 'Цена до скидок (зачеркнута на карточке товара)',
        required: true,
    })
    @IsNumberString()
    @IsNotEmpty()
    old_price?: string;
    @ApiProperty({
        description: 'Цена товара с учётом скидок, отображается на карточке товара.',
        required: true,
    })
    @IsNumberString()
    @IsNotEmpty()
    price?: string;
    @ApiProperty({ description: 'Идентификатор товара в системе продавца.', required: true })
    @IsNotEmpty()
    offer_id: string;
    @ApiProperty({ description: 'Идентификатор товара Ozon', required: false })
    @IsOptional()
    @IsNumber()
    product_id?: number;
    @ApiProperty({ description: 'Входящая цена', required: false })
    @IsOptional()
    @IsNumber()
    incoming_price?: number;
    sum_pack?: number;
    @ApiProperty({
        description: 'Ставка НДС (число или строка)',
        required: false,
        example: 0
    })
    @IsOptional()
    vat?: string | number;
}

export class UpdatePricesDto {
    @ApiProperty({ description: 'Массив цен для обновления', type: UpdatePriceDto, isArray: true })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdatePriceDto)
    prices: UpdatePriceDto[];
}
