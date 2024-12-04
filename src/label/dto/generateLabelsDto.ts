import { ApiProperty } from "@nestjs/swagger";
import { LabelDto } from "./labelDto";
import { IsArray, IsEnum, IsNumber, IsOptional, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { SizeDto } from "./sizeDto";
import { BarcodeType } from "./barcodeType";

export class GenerateLabelsDto {
    @ApiProperty({ type: [LabelDto], description: "Array of labels data" })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => LabelDto)
    labelsData: LabelDto[];

    @ApiProperty({ type: SizeDto, description: "Size of each label" })
    @ValidateNested()
    @Type(() => SizeDto)
    size: SizeDto;

    @ApiProperty({ enum: BarcodeType, description: "Type of barcode" })
    @IsEnum(BarcodeType, { message: "Invalid barcode type" })
    barcodeType: BarcodeType;

    @ApiProperty({
        description: 'Horizontal margin as a percentage of label width',
        example: 5,
        required: false,
    })
    @IsOptional()
    @IsNumber()
    marginX: number = 5;

    @ApiProperty({
        description: 'Vertical margin as a percentage of label height',
        example: 0,
        required: false,
    })
    @IsOptional()
    @IsNumber()
    marginY: number = 0;

    @ApiProperty({
        description: 'Height of the barcode as a percentage of label height',
        example: 50,
        required: false,
    })
    @IsOptional()
    @IsNumber()
    barcodeHeightPercent: number = 50;

    @ApiProperty({
        description: 'Width of the barcode as a percentage of label width',
        example: 95,
        required: false,
    })
    @IsOptional()
    @IsNumber()
    barcodeWidthPercent: number = 95;

    @ApiProperty({
        description: 'Spacing between barcode and text in points',
        example: 2,
        required: false,
    })
    @IsOptional()
    @IsNumber()
    spacingBetweenBarcodeAndText: number = 2;
}