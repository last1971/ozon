import { ApiProperty } from "@nestjs/swagger";

export class WbSupplyOrderDto {
    @ApiProperty({
        description: "Цена приёмки в копейках. Появляется после фактической приёмки заказа. Для данного метода всегда будет возвращаться null",
        type: "number",
        nullable: true,
        example: null
    })
    scanPrice: number | null;

    @ApiProperty({
        description: "ID транзакции для группировки сборочных заданий. Сборочные задания в одной корзине покупателя будут иметь одинаковый orderUID",
        type: "string",
        example: "123e4567-e89b-12d3-a456-426614174000"
    })
    orderUid: string;

    @ApiProperty({
        description: "Артикул продавца",
        type: "string",
        example: "ABC-123"
    })
    article: string;

    @ApiProperty({
        description: "Код цвета (только для колеруемых товаров)",
        type: "string",
        example: "RED123"
    })
    colorCode: string;

    @ApiProperty({
        description: "ID сборочного задания в системе Wildberries",
        type: "string",
        example: "RID98765"
    })
    rid: string;

    @ApiProperty({
        description: "Дата создания сборочного задания (RFC3339)",
        type: "string",
        format: "date-time",
        example: "2023-10-25T14:23:00Z"
    })
    createdAt: string;

    @ApiProperty({
        description: "Список офисов, куда следует привезти товар",
        type: [String],
        nullable: true,
        example: ["Office1", "Office2"]
    })
    offices: string[] | null;

    @ApiProperty({
        description: "Массив баркодов товара",
        type: [String],
        example: ["SKU123", "SKU456", "SKU789"]
    })
    skus: string[];

    @ApiProperty({
        description: "ID сборочного задания в Маркетплейсе",
        type: "integer",
        format: "int64",
        example: 123456789
    })
    id: number;

    @ApiProperty({
        description: "ID склада продавца, на который поступило сборочное задание",
        type: "integer",
        example: 5
    })
    warehouseId: number;

    @ApiProperty({
        description: "Артикул WB",
        type: "integer",
        example: 78910234
    })
    nmId: number;

    @ApiProperty({
        description: "ID размера товара в системе Wildberries",
        type: "integer",
        example: 43210987
    })
    chrtId: number;

    @ApiProperty({
        description: "Цена в валюте продажи с учётом всех скидок, кроме суммы по WB Кошельку, умноженная на 100. Код валюты продажи — в поле currencyCode",
        type: "integer",
        example: 15000
    })
    price: number;

    @ApiProperty({
        description: "Цена в валюте страны продавца с учетом всех скидок, кроме суммы по WB Кошельку, умноженная на 100. Предоставляется в информационных целях.",
        type: "integer",
        example: 12500
    })
    convertedPrice: number;

    @ApiProperty({
        description: "Код валюты продажи (ISO 4217)",
        type: "integer",
        example: 840
    })
    currencyCode: number;

    @ApiProperty({
        description: "Код валюты страны продавца (ISO 4217)",
        type: "integer",
        example: 978
    })
    convertedCurrencyCode: number;

    @ApiProperty({
        description: "Тип товара: 1 - обычный, 2 - СГТ (Сверхгабаритный товар), 3 - КГТ+ (Крупногабаритный товар)",
        type: "integer",
        enum: [1, 2, 3],
        example: 1
    })
    cargoType: number;

    @ApiProperty({
        description: "Признак заказа сделанного на нулевой остаток товара. (false - заказ сделан на товар с ненулевым остатком, true - заказ сделан на товар с остатком равным нулю. Такой заказ можно отменить без штрафа за отмену)",
        type: "boolean",
        example: false
    })
    isZeroOrder: any;
}