import { Controller, Get, Inject, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FIREBIRD } from './firebird/firebird.module';
import { FirebirdPool } from 'ts-firebird';
import { PoolStatsDto } from './firebird/dto/pool.stats.dto';
import { MailService } from './mail/mail.service';

@ApiTags('app')
@Controller()
export class AppController {
    constructor(
        private readonly appService: AppService,
        private readonly vaultService: VaultService,
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly mailService: MailService,
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

    @Post('mail/test')
    @ApiOperation({ summary: 'Тестовое письмо' })
    async testMail(): Promise<{ sent: boolean }> {
        const sent = await this.mailService.checkHealth();
        return { sent };
    }
}
