import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnLineDto } from './return-line.dto';
import { ReturnInvoiceLine, ReturnLineCode } from '../../interfaces/i.return.stock';
import { ReturnDecision } from '../../mp-event/mp-return-accept.store';

export class ReturnInvoiceViewDto {
    @ApiProperty() scode: number;
    @ApiPropertyOptional() number: number | null;
    @ApiPropertyOptional() date: string | null;
    @ApiProperty() status: number;
    @ApiPropertyOptional() prim: string | null;
    @ApiProperty({ description: 'Пометка после номера отправления в PRIM' }) mark: string;
    @ApiProperty({ description: 'Счёт-донор (« отмена FBO» / WBFBO)' }) isDonor: boolean;
}

export class ReturnAcceptViewDto {
    @ApiProperty({ enum: ['RETURN', 'PROBLEM'] }) decision: ReturnDecision;
    @ApiPropertyOptional() username: string | null;
    @ApiProperty() createdAt: string;
    @ApiProperty({ type: [String] }) kis: string[];
    @ApiPropertyOptional() comment: string | null;
    @ApiPropertyOptional() spisCode: number | null;
    @ApiPropertyOptional() spisAt: string | null;
}

/** Карточка возврата: что вернулось, чей счёт, что можно сделать и почему нельзя. */
export class ReturnCardDto {
    @ApiProperty({ type: ReturnLineDto }) line: ReturnLineDto;
    @ApiPropertyOptional({ type: ReturnInvoiceViewDto }) invoice: ReturnInvoiceViewDto | null;
    @ApiPropertyOptional() invoiceLine: ReturnInvoiceLine | null;
    @ApiProperty({ description: 'Коды маркировки на строке счёта' }) codes: ReturnLineCode[];
    @ApiProperty({ description: 'Штук в юните маркетплейса' }) pieces: number;
    @ApiProperty({ description: 'Штук вернулось = юниты × фасовка' }) quan: number;
    @ApiProperty({ description: 'На строке есть коды — при приёме нужен скан марок на quan штук' })
    marksRequired: boolean;
    @ApiPropertyOptional({ type: ReturnAcceptViewDto }) accepted: ReturnAcceptViewDto | null;
    @ApiProperty({ type: [String] }) warnings: string[];
    @ApiProperty({ type: [String], description: 'Почему принять нельзя' }) blockers: string[];
    @ApiProperty() canAccept: boolean;
    @ApiProperty() canWriteOff: boolean;
}

export type ReturnRowStatus = 'pending' | 'accepted' | 'written-off' | 'problem' | 'blocked';

/** Строка списка: карточка без кодов и строки счёта + итоговый статус. */
export class ReturnRowDto {
    @ApiProperty({ type: ReturnLineDto }) line: ReturnLineDto;
    @ApiPropertyOptional() invoiceNumber: number | null;
    @ApiPropertyOptional() goodsName: string | null;
    @ApiProperty() quan: number;
    @ApiProperty({ enum: ['pending', 'accepted', 'written-off', 'problem', 'blocked'] }) status: ReturnRowStatus;
    @ApiProperty({ type: [String] }) blockers: string[];
    @ApiProperty({ type: [String] }) warnings: string[];
}
