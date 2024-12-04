import { ApiProperty } from "@nestjs/swagger";
import { BarcodeType } from "./barcodeType";
import { IsEnum, IsInt, IsString, Length, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export class GenerateBarcodeDto {
    @ApiProperty({ description: "Тип штрихкода", enum: BarcodeType })
    @IsEnum(BarcodeType)
    bcid: BarcodeType;

    @ApiProperty({ description: "Текст для штрихкода", example: "1234567890" })
    @IsString()
    @Length(1, 50)
    text: string;

    @ApiProperty({ description: "Высота штрихкода", example: 10 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    height: number;

    @ApiProperty({ description: "Ширина штрихкода", example: 30 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    width: number;
}