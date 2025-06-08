import { ApiProperty } from "@nestjs/swagger";
import { WbOrderStickerDto } from "./wb.order.sticker.dto";

export class WbOrderStickersDto {
    @ApiProperty({
        description: 'Список стикеров',
        type: [WbOrderStickerDto],
    })
    stickers: WbOrderStickerDto[];

    @ApiProperty({
        description: 'Статус выполнения запроса',
        example: true,
    })
    success: boolean;

    @ApiProperty({
        description: 'Сообщение об ошибке (если запрос завершился неудачей)',
        example: null,
        nullable: true,
    })
    error: string | null;
}