import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Счёт-донор: у того же покупателя лежит подобранный товар, который можно перекинуть. */
export class DonorDto {
    @ApiProperty({ description: 'Номер счёта-донора (S.NS), а не SCODE' })
    invoiceNumber: number;
    @ApiProperty() scode: number;
    @ApiProperty({ type: String, format: 'date-time', nullable: true })
    date: Date | null;
    @ApiProperty({ nullable: true }) prim: string | null;
    @ApiProperty() podbposcode: number;
    @ApiProperty({ description: 'Строка счёта-донора (REALPRICE), откуда едут коды' }) realpricecode: number;
    @ApiProperty({ description: 'Сколько штук подобрано на доноре по этому товару' })
    quantity: number;
    @ApiProperty({ required: false, description: 'Покупатель донора — нужен там, где ищем не в рамках одного счёта' })
    buyerCode?: number;
    @ApiPropertyOptional({ description: 'Живых кодов маркировки на строке донора' }) codesLive?: number;
    @ApiPropertyOptional({ description: 'Из них кодов номинала строки-приёмника — только такие переезжают' }) codesNominal?: number;
    @ApiPropertyOptional({ description: 'Выведенных кодов (возврат проданного без оживления) — сигнал, не запрет' }) codesDead?: number;
    @ApiPropertyOptional({ description: 'Можно ли брать с этого донора руками; причина — в reason' }) canTake?: boolean;
    @ApiPropertyOptional() reason?: string;
}

/** Строка исходного счёта и доноры под неё. */
export class DonorLineDto {
    @ApiProperty() realpricecode: number;
    @ApiProperty() goodscode: string;
    @ApiProperty({ nullable: true }) name: string | null;
    @ApiProperty({ description: 'Сколько штук нужно по строке счёта' })
    quantity: number;
    @ApiProperty({ nullable: true, description: 'Фасовка строки (REALPRICE.PIECES): номинал кода; null — неизвестна (старый счёт)' })
    pieces: number | null;
    @ApiProperty({ description: 'Сколько штук уже подобрано на этой строке' }) picked: number;
    @ApiProperty({ description: 'Недобор строки = нужно − подобрано' }) shortage: number;
    @ApiProperty({ description: 'Товар строки числится в журнале недобора FBO_SHORTAGE' }) inShortage: boolean;
    @ApiProperty({ type: [DonorDto] }) donors: DonorDto[];
}

/** Ответ ручки: счёт, найденный по подстроке в примечании, и доноры по каждой его строке. */
export class InvoiceDonorsDto {
    @ApiProperty({ description: 'Номер счёта (S.NS), для которого искали доноров' })
    invoiceNumber: number;
    @ApiProperty() scode: number;
    @ApiProperty({ description: 'Статус счёта (S.STATUS): 1 — сформирован, 3 — в подборке, 4 — подобран' }) status: number;
    @ApiProperty({ type: String, format: 'date-time', nullable: true })
    date: Date | null;
    @ApiProperty({ nullable: true }) prim: string | null;
    @ApiProperty() buyerCode: number;
    @ApiProperty({ description: 'Счёт числится в журнале недобора FBO_SHORTAGE' }) inShortage: boolean;
    @ApiProperty({ type: [DonorLineDto] }) lines: DonorLineDto[];
}

/** Ответ поиска по артикулу: счёта-получателя тут нет, поэтому только товар и его доноры. */
export class GoodDonorsDto {
    @ApiProperty({ description: 'Код товара, в который развернулся артикул' })
    goodscode: string;
    @ApiProperty({ nullable: true }) name: string | null;
    @ApiProperty({ type: [DonorDto] }) donors: DonorDto[];
}

/** Строка журнала недобора FBO_SHORTAGE. */
export class FboShortageRowDto {
    @ApiProperty() service: string;
    @ApiProperty() posting: string;
    @ApiProperty() goodscode: string;
    @ApiProperty({ nullable: true }) name: string | null;
    @ApiProperty() quantity: number;
    @ApiProperty({ nullable: true, description: 'Склад (метка подбора)' }) prim: string | null;
    @ApiProperty({ type: String, format: 'date-time', nullable: true }) date: Date | null;
}
