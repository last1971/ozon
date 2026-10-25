import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SupplierTierOutDto {
    @ApiProperty({ example: 100 })
    quantity: number;
    @ApiProperty({ description: 'Цена за штуку, руб.', example: 2.1 })
    price: number;
}

/** Одна исходящая строка: рубли для сайта. Вид цен — как в UpdatePriceDto (price / old_price / min_price). */
export class SupplierPriceResultDto {
    @ApiProperty()
    supplier: string;
    @ApiProperty()
    code: string;
    @ApiProperty({ description: 'Закупка в рублях после курса (без доставки)' })
    incoming_price: number;
    @ApiProperty({ description: 'Доставка от поставщика, руб. за штуку' })
    delivery: number;
    @ApiProperty({ description: 'Цена на сайте, руб.' })
    price: number;
    @ApiProperty({ description: 'Зачёркнутая цена, руб.' })
    old_price: number;
    @ApiProperty({ description: 'Минимальная цена, руб.' })
    min_price: number;
    @ApiProperty() min_perc: number;
    @ApiProperty() perc: number;
    @ApiProperty() old_perc: number;
    @ApiProperty({ type: SupplierTierOutDto, isArray: true })
    tiers: SupplierTierOutDto[];
}

export class SupplierPriceErrorDto {
    @ApiProperty() supplier: string;
    @ApiProperty() code: string;
    @ApiProperty() error: string;
}

export class SupplierPriceResponseDto {
    @ApiProperty({ type: SupplierPriceResultDto, isArray: true })
    prices: SupplierPriceResultDto[];
    @ApiPropertyOptional({ type: SupplierPriceErrorDto, isArray: true })
    errors: SupplierPriceErrorDto[];
}
