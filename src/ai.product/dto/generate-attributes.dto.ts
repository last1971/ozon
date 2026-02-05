import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductDataDto {
    @ApiPropertyOptional({ description: 'Название товара' })
    name?: string;

    @ApiPropertyOptional({ description: 'Артикул' })
    article?: string;

    @ApiPropertyOptional({ description: 'Бренд' })
    brand?: string;

    @ApiPropertyOptional({ description: 'Описание' })
    description?: string;

    @ApiPropertyOptional({ description: 'Характеристики' })
    characteristics?: Record<string, string>;
}

export class RequiredAttributeDto {
    @ApiProperty({ description: 'ID атрибута' })
    id: number;

    @ApiProperty({ description: 'Название атрибута' })
    name: string;

    @ApiProperty({ description: 'Тип атрибута' })
    type: string;
}

export class GenerateAttributesRequestDto {
    @ApiProperty({ description: 'ID типа товара в Ozon' })
    type_id: number;

    @ApiProperty({ type: ProductDataDto, description: 'Данные товара' })
    product_data: ProductDataDto;

    @ApiPropertyOptional({ type: [RequiredAttributeDto], description: 'Список обязательных атрибутов' })
    required_attributes?: RequiredAttributeDto[];
}

export class AttributeValueDto {
    @ApiPropertyOptional({ description: 'ID значения из справочника' })
    dictionary_value_id?: number;

    @ApiPropertyOptional({ description: 'Строковое значение' })
    value?: string;
}

export class GeneratedAttributeDto {
    @ApiProperty({ description: 'Complex ID' })
    complex_id: number;

    @ApiProperty({ description: 'ID атрибута' })
    id: number;

    @ApiProperty({ type: [AttributeValueDto], description: 'Значения атрибута' })
    values: AttributeValueDto[];
}

export class GenerateAttributesResponseDto {
    @ApiProperty({ type: [GeneratedAttributeDto], description: 'Сгенерированные атрибуты' })
    attributes: GeneratedAttributeDto[];

    @ApiProperty({ description: 'Использованные токены' })
    tokens_used: number;

    @ApiProperty({ description: 'Стоимость запроса' })
    cost: number;
}
