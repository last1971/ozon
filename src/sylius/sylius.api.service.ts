import { SerialTaskQueue } from '../helpers/serial-task.queue';
import { assertPricingRequestAllowed } from '../helpers/price/pricing-review-mode';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { formatAxiosError } from '../helpers/http/format-axios-error';

type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';

@Injectable()
export class SyliusApiService {
    private readonly logger = new Logger(SyliusApiService.name);
    private readonly stockWrites = new SerialTaskQueue();
    private accessToken: string | null = null;
    private accessTokenExpiresAt: number | null = null;

    constructor(
        private readonly http: HttpService,
        private readonly configService: ConfigService,
    ) {}

    async method<T = any>(path: string, method: HttpVerb = 'get', data?: any): Promise<T> {
        assertPricingRequestAllowed('sylius', path, method);
        const url = this.buildUrl(path);

        const stockWrite = method === 'post' && path === '/api/v2/admin/stock/update';
        const send = () => this.sendWithRetry<T>(url, method, data, stockWrite);
        return stockWrite ? this.stockWrites.run(url, send) : send();
    }

    private async sendWithRetry<T>(url: string, method: HttpVerb, data: any, stockWrite: boolean): Promise<T> {
        let token = await this.getAccessToken(false);
        let refreshed = false;
        let conflicts = 0;
        for (;;) {
            try {
                return await this.makeRequest<T>(url, method, data, token);
            } catch (err) {
                const axiosErr = err as AxiosError<any>;
                if (!refreshed && this.isUnauthorized(axiosErr)) {
                    refreshed = true;
                    token = await this.getAccessToken(true);
                    continue;
                }
                // Подтверждённый отказ транзакции Sylius. Здесь задаются абсолютные остатки,
                // поэтому повтор допустим; остальные 409 и сетевые сбои не повторяем.
                if (
                    stockWrite &&
                    axiosErr.response?.status === 409 &&
                    /optimistic lock on an entity failed/i.test(axiosErr.response?.data?.detail ?? '') &&
                    conflicts < 2
                ) {
                    const delay = 250 * ++conflicts;
                    this.logger.warn(`Sylius: конфликт записи остатков, повтор ${conflicts}/2 через ${delay} мс`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
                this.logger.error(formatAxiosError(axiosErr, { url, method, body: data }));
                throw err;
            }
        }
    }

    private buildUrl(path: string): string {
        const base = this.configService.get<string>('SYLIUS_URL', '');
        const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
        return path.startsWith('/') ? trimmed + path : `${trimmed}/${path}`;
    }

    private async makeRequest<T>(url: string, method: HttpVerb, data: any, token: string): Promise<T> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            Accept: method === 'get' ? 'application/ld+json' : 'application/json',
            'Content-Type': method === 'patch' ? 'application/merge-patch+json' : 'application/json',
        };

        const obs =
            method === 'get'
                ? this.http.get(url, { params: data, headers })
                : this.http.request({ url, method, data, headers });

        return await firstValueFrom(obs.pipe(map((res) => res.data as T)));
    }

    private isUnauthorized(error: AxiosError | any): boolean {
        const status = (error?.response as any)?.status;
        return status === 401 || status === 403;
    }

    private async getAccessToken(forceRefresh: boolean): Promise<string> {
        const now = Date.now();
        const bufferMs = 60_000;

        if (
            !forceRefresh &&
            this.accessToken &&
            this.accessTokenExpiresAt &&
            now + bufferMs < this.accessTokenExpiresAt
        ) {
            return this.accessToken;
        }

        const { token, expiresAt } = await this.fetchNewToken();
        this.accessToken = token;
        this.accessTokenExpiresAt = expiresAt;
        return token;
    }

    private async fetchNewToken(): Promise<{ token: string; expiresAt: number }> {
        const email = this.configService.get<string>('SYLIUS_EMAIL', '');
        const password = this.configService.get<string>('SYLIUS_PASSWORD', '');
        const ttlSeconds = this.configService.get<number>('SYLIUS_TOKEN_TTL', 3600);

        const tokenUrl = this.buildUrl('/api/v2/admin/administrators/token');

        try {
            const res = await firstValueFrom(
                this.http.post(
                    tokenUrl,
                    { email, password },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                        },
                    },
                ),
            );

            const accessToken = res.data?.token as string;
            if (!accessToken) {
                throw new Error('Sylius token response missing token');
            }

            const expiresAt = Date.now() + ttlSeconds * 1000;
            return { token: accessToken, expiresAt };
        } catch (e: any) {
            const msg = e?.response?.data?.message || e?.message || 'Unknown token error';
            this.logger.error(`Sylius token fetch failed: ${msg}`);
            throw e;
        }
    }
}
