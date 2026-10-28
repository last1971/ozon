import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/** Артикул коробки из шаблона Озона — экран присылает его вместе со сканом, состав живёт в файле. */
export class SupplyLineDto {
    @ApiProperty({ example: '562990' }) @IsString() @IsNotEmpty() @MaxLength(50) offerId: string;
    @ApiProperty({ example: 'OZN1754772007' }) @IsString() @MaxLength(40) ozonBarcode: string;
    @ApiProperty({ description: 'Сколько экземпляров нужно в коробке' }) @IsInt() @Min(1) need: number;
}

export class SupplyBoundDto {
    @ApiProperty() qr: string;
    @ApiProperty() cargoId: string;
    @ApiProperty() offerId: string;
    @ApiProperty() goodscode: number;
    @ApiPropertyOptional({ description: 'Код ЧЗ, если товар сканировали кодом маркировки' }) ki: string | null;
    @ApiPropertyOptional() username: string | null;
    @ApiProperty() createdAt: string;
}

export class SupplyLineViewDto {
    @ApiProperty() offerId: string;
    @ApiProperty() ozonBarcode: string;
    @ApiPropertyOptional() goodscode: number | null;
    @ApiProperty() pieces: number;
    @ApiPropertyOptional() name: string | null;
    @ApiProperty() need: number;
}

export class SupplyBoxDto {
    @ApiProperty() cargoId: string;
    @ApiProperty() cargoType: string;
    @ApiProperty({ type: [SupplyLineViewDto] }) lines: SupplyLineViewDto[];
}

export class SupplyTemplateDto {
    @ApiProperty({ type: [SupplyBoxDto] }) boxes: SupplyBoxDto[];
    @ApiProperty({ type: [SupplyBoundDto], description: 'Уже привязанные этикетки этих коробок' })
    bound: SupplyBoundDto[];
}

export class ResolveProductDto {
    @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) cargoId: string;
    @ApiProperty({ type: [SupplyLineDto] })
    @ArrayNotEmpty()
    @ValidateNested({ each: true })
    @Type(() => SupplyLineDto)
    lines: SupplyLineDto[];
    @ApiProperty({ description: 'Скан товара: штрихкод, штрихкод Озона или код ЧЗ' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    scan: string;
}

export class ResolvedProductDto {
    @ApiProperty() goodscode: number;
    @ApiPropertyOptional() name: string | null;
    @ApiProperty({
        type: [String],
        description: 'Артикулы коробки, которыми может быть товар; больше одного — выбрать',
    })
    offerIds: string[];
    @ApiPropertyOptional() ki: string | null;
}

export class BindQrDto extends ResolveProductDto {
    @ApiProperty({ example: 'ii50126995216' }) @IsString() @IsNotEmpty() @MaxLength(40) qr: string;
    @ApiPropertyOptional({ description: 'Выбранный артикул, если товар подходит к нескольким' })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    offerId?: string;
    @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) username: string;
}
