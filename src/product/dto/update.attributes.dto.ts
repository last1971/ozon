import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttributeValueDto {
    @ApiPropertyOptional()
    dictionary_value_id?: number;

    @ApiPropertyOptional()
    value?: string;
}

export class AttributeDto {
    @ApiProperty()
    complex_id: number;

    @ApiProperty()
    id: number;

    @ApiProperty({ type: [AttributeValueDto] })
    values: AttributeValueDto[];
}

export class UpdateAttributesBodyDto {
    @ApiPropertyOptional({ type: [String] })
    offer_ids?: string[];

    @ApiProperty({ type: [AttributeDto] })
    attributes: AttributeDto[];
}

export class UpdateAttributesResponseDto {
    @ApiProperty()
    task_id: number;
}
