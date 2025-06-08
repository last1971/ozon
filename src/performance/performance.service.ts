import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { VaultService } from 'vault-module/lib/vault.service';
import { HttpWrapperService } from '../helpers/http/http-wrapper.service';
import { PerformanceResponseDto } from './dto/performance-response.dto';
import { plainToInstance } from 'class-transformer';
import { CronExpression } from '@nestjs/schedule';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PerformanceService implements OnModuleInit {
    private logger = new Logger(PerformanceService.name);
    private ozon: any;
    private token: string | null = null;
    private tokenTimestamp: number = 0;
    private readonly TOKEN_LIFETIME_MS = 20 * 60 * 1000; // 20 минут в миллисекундах

    constructor(
        private readonly httpWrapper: HttpWrapperService,
        private readonly vaultService: VaultService,
        private readonly config: ConfigService,
    ) {}

    async onModuleInit() {
        this.ozon = await this.vaultService.get('ozon');
    }

    private isTokenValid(): boolean {
        if (!this.token) return false;
        return Date.now() - this.tokenTimestamp < this.TOKEN_LIFETIME_MS;
    }

    private async requestNewToken(): Promise<string | null> {
        const { result, error } = await this.httpWrapper.request(
            'post',
            this.ozon.PERFOMANCE_URL + '/api/client/token',
            {
                data: {
                    client_id: this.ozon.PERFOMANCE_CLIENT_ID,
                    client_secret: this.ozon.PERFOMANCE_CLIENT_SECRET,
                    grant_type: 'client_credentials',
                },
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
            },
        );

        if (error) {
            this.logger.error(`Failed to get token: ${error.message}`);
            return null;
        }

        this.token = result.access_token;
        this.tokenTimestamp = Date.now();
        return this.token;
    }

    private async getToken(): Promise<string> {
        if (this.isTokenValid()) {
            return this.token;
        }

        return await this.requestNewToken();
    }

    async activateCampaign(campaignId: number): Promise<boolean> {
        const token = await this.getToken();
        const { error } = await this.httpWrapper.request(
            'post',
            `${this.ozon.PERFOMANCE_URL}/api/client/campaign/${campaignId}/activate`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                data: {},
            },
        );

        if (error) {
            this.logger.error(`Failed to activate campaign ${campaignId}: ${error.message}`);
            return false;
        }

        return true;
    }

    async deactivateCampaign(campaignId: number): Promise<boolean> {
        const token = await this.getToken();
        const { error } = await this.httpWrapper.request(
            'post',
            `${this.ozon.PERFOMANCE_URL}/api/client/campaign/${campaignId}/deactivate`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                data: {},
            },
        );

        if (error) {
            this.logger.error(`Failed to deactivate campaign ${campaignId}: ${error.message}`);
            return false;
        }

        return true;
    }

    async getCampaignExpense(campaignIds: number[], dateFrom: string, dateTo: string): Promise<PerformanceResponseDto> {
        const token = await this.getToken();
        const { result, error } = await this.httpWrapper.request(
            'get',
            this.ozon.PERFOMANCE_URL + '/api/client/statistics/daily/json',
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                params: {
                    campaignIds: campaignIds.join(','),
                    dateFrom,
                    dateTo,
                },
            },
        );

        if (error) {
            this.logger.error(`Failed to get campaign expense: ${error.message}`);
            return { rows: [] };
        }

        return plainToInstance(PerformanceResponseDto, result, { enableImplicitConversion: true });
    }

    async getTodayMoneySpent(campaignIds: number[]): Promise<number> {
        const data = await this.getCampaignExpense(
            campaignIds,
            new Date().toISOString().split('T')[0],
            new Date().toISOString().split('T')[0],
        );
        return data.rows.reduce((acc, row) => acc + row.moneySpent, 0);
    }

    private async getCampaignIds(): Promise<number[]> {
        return this.ozon.PERFOMACE_CAMPAIGN_IDS.split(',')
            .map((id) => parseInt(id, 10))
            .filter(id => !isNaN(id));
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'enableOzonCampaigns' })
    async enablePlanedCampaigns(): Promise<void> {
        const campaigns = await this.getCampaignIds();
        if (campaigns.length === 0) return;
        
        for (const campaign of campaigns) {
            await this.activateCampaign(campaign);
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'checkOzonCampaigns' })
    async checkAndDeactivateCampaigns(): Promise<void> {
        const campaigns = await this.getCampaignIds();
        if (campaigns.length === 0) return;

        const maxSpend = this.config.get<number>('MAX_DAILY_SPEND', 1000);

        for (const campaignId of campaigns) {
            const spent = await this.getTodayMoneySpent([campaignId]);
            if (spent > maxSpend) {
                await this.deactivateCampaign(campaignId);
            }
        }
    }
}
