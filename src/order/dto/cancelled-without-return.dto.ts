import { ApiProperty } from '@nestjs/swagger';

/** Заказ отменён у Ozon, записи возврата у Ozon нет, а счёт у нас ещё живой. */
export class CancelledWithoutReturnDto {
    @ApiProperty({ description: 'Номер отправления' })
    posting_number: string;

    @ApiProperty({ description: 'Схема: FBO | FBS' })
    scheme: 'FBO' | 'FBS';

    @ApiProperty({ description: 'Дата заказа у Ozon' })
    created_at: string;

    @ApiProperty({ description: 'Причина отмены у Ozon (как отдаёт API)', required: false })
    cancel_reason?: string;

    @ApiProperty({ description: 'SCODE счёта' })
    invoice_id: number;

    @ApiProperty({ description: 'Номер счёта', required: false })
    invoice_number?: number;

    @ApiProperty({ description: 'S.STATUS счёта' })
    invoice_status: number;

    @ApiProperty({ description: 'Пометка в PRIM после номера (ручная), пусто — нет' })
    mark: string;
}
