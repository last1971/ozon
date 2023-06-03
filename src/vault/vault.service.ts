import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Vault from 'hashi-vault-js';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class VaultService {
    private vault: Vault;
    private token: string;
    private data: any = {};
    constructor(private configService: ConfigService) {
        this.vault = new Vault({
            https: true,
            baseUrl: this.configService.get('VAULT_URL', 'https://vault.tooot.ru:8200/v1'),
            rootPath: this.configService.get('VAULT_PATH', 'api-data'),
            timeout: 2000,
            proxy: false,
        });
    }
    private async login() {
        const response = await this.vault.loginWithUserpass(
            this.configService.get('VAULT_USER'),
            this.configService.get('VAULT_PASS'),
            'auth/userpass',
        );
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.token = response.client_token;
    }
    async get(path: string): Promise<Record<string, unknown>> {
        if (!this.token) {
            await this.login();
        }
        if (!this.data[path]) {
            const response = await this.vault.readKVSecret(this.token, path);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            this.data[path] = response.data;
        }
        return this.data[path];
    }
    @Cron('0 0 * * * *')
    private async renewToken(): Promise<void> {
        await this.login();
    }
}
