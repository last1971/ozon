import { ApiProperty } from "@nestjs/swagger";
import { WbSupplyOrderDto } from "./wb.supply.order.dto";

export class WbSupplyOrdersDto {
    @ApiProperty({
        description: 'Список заказов в поставке',
        type: [WbSupplyOrderDto],
    })
    orders: WbSupplyOrderDto[];

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