import { ApiProperty } from '@nestjs/swagger';

export class TransactionFilterDate {
    @ApiProperty({ required: true, type: Date })
    from: Date;
    @ApiProperty({ required: true, type: Date })
    to: Date;
}

/**
 * Период прогона начислений. Раньше здесь жил ещё transaction_type — он был нужен
 * только ручке /v3/finance/transaction/list, которую Ozon отключает 08.09.2026.
 * Новый путь ходит в /v1/finance/accrual/by-day, там фильтр по типу не нужен.
 */
export class TransactionFilterDto {
    @ApiProperty({ required: true, type: () => TransactionFilterDate })
    date: TransactionFilterDate;
}
