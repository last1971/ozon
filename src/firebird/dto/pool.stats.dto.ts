import { ApiProperty } from '@nestjs/swagger';

export class PoolStatsDto {
    @ApiProperty({ description: 'Максимальное количество соединений в пуле' })
    maxConnections: number;

    @ApiProperty({ description: 'Количество активных соединений' })
    activeConnections: number;

    @ApiProperty({ description: 'Количество доступных соединений' })
    availableConnections: number;

    @ApiProperty({ description: 'Количество активных транзакций' })
    activeTransactions: number;

    @ApiProperty({ description: 'Процент использования пула' })
    utilizationPercent: number;
}
