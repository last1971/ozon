import { ApiProperty } from "@nestjs/swagger";

export class WbOrderStickerDto {
    @ApiProperty({
        description: "ID сборочного задания",
        type: "integer",
        format: "int64"
    })
    orderId: number;

    @ApiProperty({
        description: "Первая часть ID стикера (для печати подписи)",
        type: "integer"
    })
    partA: number;

    @ApiProperty({
        description: "Вторая часть ID стикера",
        type: "integer"
    })
    partB: number;

    @ApiProperty({
        description: "Закодированное значение стикера",
        type: "string"
    })
    barcode: string;

    @ApiProperty({
        description: "Полное представление стикера в заданном формате (кодировка base64)",
        type: "string",
        format: "byte"
    })
    file: string;
}