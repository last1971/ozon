import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateCharacteristicsDto {
    @ApiProperty({ description: 'Название товара' })
    productName: string;

    @ApiProperty({ description: 'Описание/аннотация товара' })
    description: string;

    @ApiProperty({ description: 'WB subjectId категории' })
    subjectId: number;

    @ApiPropertyOptional({ description: 'Включить веб-поиск' })
    webSearch?: boolean;

    @ApiPropertyOptional({ description: 'Размеры из Ozon (attr 4382), напр. "215x115x30"' })
    ozonDimensions?: string;

    @ApiPropertyOptional({ description: 'Вес из Ozon (attr 4383), напр. "827"' })
    ozonWeight?: string;

    @ApiPropertyOptional({ description: 'Гарантийный срок из Ozon (attr 4385), напр. "14 дней"' })
    ozonWarranty?: string;
}
