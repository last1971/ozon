import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('app')
@Controller()
export class AppController {
    constructor(
        private readonly appService: AppService,
        private readonly vaultService: VaultService,
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
}
