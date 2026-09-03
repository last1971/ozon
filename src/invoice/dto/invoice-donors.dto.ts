import { ApiProperty } from '@nestjs/swagger';

/** Счёт-донор: у того же покупателя лежит подобранный товар, который можно перекинуть. */
export class DonorDto {
    @ApiProperty({ description: 'Номер счёта-донора (S.NS), а не SCODE' })
    invoiceNumber: number;
    @ApiProperty() scode: number;
    @ApiProperty({ type: String, format: 'date-time', nullable: true })
    date: Date | null;
    @ApiProperty({ nullable: true }) prim: string | null;
    @ApiProperty() podbposcode: number;
    @ApiProperty({ description: 'Сколько штук подобрано на доноре по этому товару' })
    quantity: number;
    @ApiProperty({ required: false, description: 'Покупатель донора — нужен там, где ищем не в рамках одного счёта' })
    buyerCode?: number;
}

/** Строка исходного счёта и доноры под неё. */
export class DonorLineDto {
    @ApiProperty() realpricecode: number;
    @ApiProperty() goodscode: string;
    @ApiProperty({ nullable: true }) name: string | null;
    @ApiProperty({ description: 'Сколько штук нужно по строке счёта' })
    quantity: number;
    @ApiProperty({ type: [DonorDto] }) donors: DonorDto[];
}

/** Ответ ручки: счёт, найденный по подстроке в примечании, и доноры по каждой его строке. */
export class InvoiceDonorsDto {
    @ApiProperty({ description: 'Номер счёта (S.NS), для которого искали доноров' })
    invoiceNumber: number;
    @ApiProperty() scode: number;
    @ApiProperty({ type: String, format: 'date-time', nullable: true })
    date: Date | null;
    @ApiProperty({ nullable: true }) prim: string | null;
    @ApiProperty() buyerCode: number;
    @ApiProperty({ type: [DonorLineDto] }) lines: DonorLineDto[];
}

/** Ответ поиска по артикулу: счёта-получателя тут нет, поэтому только товар и его доноры. */
export class GoodDonorsDto {
    @ApiProperty({ description: 'Код товара, в который развернулся артикул' })
    goodscode: string;
    @ApiProperty({ nullable: true }) name: string | null;
    @ApiProperty({ type: [DonorDto] }) donors: DonorDto[];
}
