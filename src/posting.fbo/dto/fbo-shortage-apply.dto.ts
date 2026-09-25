import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Один выбор: со строки донора столько-то штук на строку счёта-приёмника. */
export class DonorPickDto {
    @ApiProperty({ description: 'Строка счёта-приёмника (REALPRICE.REALPRICECODE)' }) realpricecode: number;
    @ApiProperty({ description: 'Подборка донора (PODBPOS.PODBPOSCODE) из предложения' }) podbposcode: number;
    @ApiProperty({ description: 'Сколько штук взять' }) quantity: number;
}

export class FboShortageApplyDto {
    @ApiProperty({ description: 'Счёт-приёмник (S.SCODE) из предложения GET /api/invoice/donors/:posting' }) scode: number;
    @ApiProperty({ type: [DonorPickDto] }) picks: DonorPickDto[];
    @ApiPropertyOptional({
        description: 'Номинал кода для строк без фасовки (REALPRICE.PIECES пуст): { realpricecode: номинал }',
        type: 'object',
        additionalProperties: { type: 'number' },
    })
    nominals?: Record<string, number>;
}

/** Что переехало по одному выбору. */
export class DonorMovedDto {
    @ApiProperty() realpricecode: number;
    @ApiProperty() goodscode: string;
    @ApiProperty({ description: 'Счёт-донор (S.NS)' }) donorInvoiceNumber: number;
    @ApiProperty() quantity: number;
    @ApiProperty({ type: [String], description: 'Коды маркировки, переехавшие вместе с товаром' }) codes: string[];
}

export class FboShortageApplyResultDto {
    @ApiProperty() posting: string;
    @ApiProperty() scode: number;
    @ApiProperty({ type: [DonorMovedDto] }) moved: DonorMovedDto[];
    @ApiProperty({ description: 'Недобора по счёту не осталось — журнал чист' }) shortageClosed: boolean;
    @ApiProperty({ description: 'Счёт отдан в подбор (как делает автоматика после переезда)' }) pickedUp: boolean;
}
