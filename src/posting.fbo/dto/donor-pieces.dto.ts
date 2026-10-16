import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Кнопка «Проставить фасовку донорам» на экране недоборов FBO. */
export class DonorPiecesRunDto {
    @ApiPropertyOptional({ description: 'Проверка без записи: только чтение базы и Озона, журнал не трогается' })
    dry?: boolean;
}

export class DonorPiecesInvoiceRefDto {
    @ApiProperty({ description: 'Номер счёта-донора (S.NS)' }) invoiceNumber: number;
    @ApiProperty() scode: number;
    @ApiProperty({ description: 'Примечание счёта' }) prim: string;
    @ApiProperty({ nullable: true, type: String, description: 'Номер поставки Озона из примечания' })
    supplyNumber: string | null;
}

export class DonorPiecesDisputeDto extends DonorPiecesInvoiceRefDto {
    @ApiProperty() goodscode: string;
    @ApiProperty({ nullable: true, type: Number, description: 'Строка счёта; пусто — спор по товару целиком' })
    realpricecode: number | null;
    @ApiProperty({ description: 'Что не сошлось и что сделать' }) reason: string;
}

export class DonorPiecesOzonErrorDto extends DonorPiecesInvoiceRefDto {
    @ApiProperty() message: string;
}

export class DonorPiecesSummaryDto {
    @ApiProperty({ description: 'Была проверка без записи' }) dry: boolean;
    @ApiProperty({ description: 'Счетов-доноров с пустой фасовкой проверено' }) checked: number;
    @ApiProperty({ description: 'Поставок найдено в Озоне' }) suppliesFound: number;
    @ApiProperty({ description: 'Строк заполнено (при проверке — сколько было бы заполнено)' }) lines: number;
    @ApiProperty({ description: 'Счетов сошлось целиком' }) done: number;
    @ApiProperty({ type: [DonorPiecesDisputeDto] }) disputes: DonorPiecesDisputeDto[];
    @ApiProperty({ type: [DonorPiecesInvoiceRefDto], description: 'В примечании нет номера поставки' })
    noNumber: DonorPiecesInvoiceRefDto[];
    @ApiProperty({ type: [DonorPiecesInvoiceRefDto], description: 'Озон такой поставки не знает' })
    notFound: DonorPiecesInvoiceRefDto[];
    @ApiProperty({ type: [DonorPiecesOzonErrorDto], description: 'Озон не ответил — следующий проход спросит заново' })
    ozonErrors: DonorPiecesOzonErrorDto[];
}
