import { ApiProperty } from '@nestjs/swagger';

export class WbClaimDto {
    @ApiProperty({ description: 'ID заявки', example: 'fe3e9337-e9f9-423c-8930-946a8ebef80' })
    id: string;

    @ApiProperty({
        description: 'Источник заявки: 1 — портал покупателей, 3 — чат',
        example: 1
    })
    claim_type: number;

    @ApiProperty({
        description: 'Решение по возврату: 0 — на рассмотрении, 1 — отказ, 2 — одобрено',
        example: 2
    })
    status: number;

    @ApiProperty({
        description: 'Статус товара: 0 — на рассмотрении, 1 — у покупателя (отклонена), 2 — в утиль, 5 — у покупателя (одобрена), 8 — возврат в реализацию, 10 — возврат продавцу',
        example: 8
    })
    status_ex: number;

    @ApiProperty({ description: 'Артикул WB', example: 196320101 })
    nm_id: number;

    @ApiProperty({ description: 'Комментарий покупателя', example: 'Длина провода не соответствует описанию' })
    user_comment: string;

    @ApiProperty({ description: 'Ответ покупателю', nullable: true })
    wb_comment: string | null;

    @ApiProperty({ description: 'Дата и время оформления заявки покупателем', example: '2024-03-26T17:06:12.245611' })
    dt: string;

    @ApiProperty({ description: 'Название товара', nullable: true, example: 'Кабель 0.5 м, 3797' })
    imt_name: string | null;

    @ApiProperty({ description: 'Дата и время заказа', example: '2020-10-27T05:18:56' })
    order_dt: string;

    @ApiProperty({ description: 'Дата и время рассмотрения заявки', example: '2024-05-10T18:01:06.999613' })
    dt_update: string;

    @ApiProperty({ description: 'Фотографии из заявки покупателя', type: [String] })
    photos: string[];

    @ApiProperty({ description: 'Видео из заявки покупателя', type: [String] })
    video_paths: string[];

    @ApiProperty({
        description: 'Варианты ответа продавца на заявку (approve1, approve2, autorefund1, reject1, reject2, reject3, rejectcustom, approvecc1, confirmreturngoodcc1)',
        type: [String]
    })
    actions: string[];

    @ApiProperty({ description: 'Фактическая цена с учетом всех скидок', example: 157 })
    price: number;

    @ApiProperty({ description: 'Код валюты цены', example: '643' })
    currency_code: string;

    @ApiProperty({ description: 'Уникальный ID заказа', example: 'v5o_7143225816503318733.0.0' })
    srid: string;
}

export class WbClaimsResponseDto {
    @ApiProperty({ description: 'Список заявок', type: [WbClaimDto] })
    claims: WbClaimDto[];

    @ApiProperty({ description: 'Общее количество заявок', example: 31 })
    total: number;
}
