import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Min } from "class-validator";

export class SizeDto {
    @ApiProperty({ example: 43, description: "Width of the label in mm" })
    @IsNumber()
    @Min(1, { message: "Width must be at least 1 mm" })
    width: number;

    @ApiProperty({ example: 25, description: "Height of the label in mm" })
    @IsNumber()
    @Min(1, { message: "Height must be at least 1 mm" })
    height: number;
}