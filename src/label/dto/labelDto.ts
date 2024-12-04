import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class LabelDto {
    @ApiProperty({ example: "123456789012", description: "Barcode text" })
    @IsString()
    @MinLength(1, { message: "Code must not be empty" })
    code: string;

    @ApiProperty({ example: "Label 1", description: "Description of the label" })
    @IsString()
    @MinLength(1, { message: "Description must not be empty" })
    description: string;
}