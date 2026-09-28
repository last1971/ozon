import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FIREBIRD } from './firebird/firebird.module';
import { FirebirdPool } from 'ts-firebird';
import { PoolStatsDto } from './firebird/dto/pool.stats.dto';
import { NotifierService } from './notify/notifier.service';
import { NotifyTopic } from './notify/notify.types';

@ApiTags('app')
@Controller()
export class AppController {
    constructor(
        private readonly appService: AppService,
        private readonly vaultService: VaultService,
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly notifier: NotifierService,
    ) {}

    @Get()
    getHello(): string {
        return this.appService.getHello();
    }

    @Post('vault/clear-cache')
    async clearVaultCache() {
        await this.vaultService.clearCache();
        return { message: 'Vault cache cleared successfully' };
    }

    @Get('firebird/pool/stats')
    @ApiOperation({ summary: 'Получить статистику пула соединений Firebird' })
    @ApiResponse({
        status: 200,
        description: 'Статистика пула соединений',
        type: PoolStatsDto
    })
    getPoolStats(): PoolStatsDto {
        const maxConnections = this.pool.getMaxConnections();
        const activeConnections = this.pool.getActiveConnectionsCount();
        const availableConnections = this.pool.getAvailableConnectionsCount();
        const activeTransactions = this.pool.getActiveTransactionsCount();
        const utilizationPercent = maxConnections > 0
            ? Math.round((activeConnections / maxConnections) * 100)
            : 0;

        return {
            maxConnections,
            activeConnections,
            availableConnections,
            activeTransactions,
            utilizationPercent,
        };
    }

    /**
     * Проверка уведомлений. С room — напрямую в комнату, мимо таблицы маршрутов
     * и гейта «не прод» (локально иначе ничего не проверить). Без room — по теме.
     */
    @Post('notify/test')
    @ApiOperation({ summary: 'Тестовое уведомление: {topic?: OPS|MARKING|PRICES|FINANCE|DEV, room?: !id:server}' })
    async testNotify(@Body() body: { topic?: NotifyTopic; room?: string }): Promise<{ ok: boolean; detail?: string }> {
        return this.notifier.test(body?.topic ?? NotifyTopic.DEV, body?.room);
    }
}
