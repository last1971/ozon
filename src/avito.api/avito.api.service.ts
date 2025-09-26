import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { VaultService } from 'vault-module/lib/vault.service';

type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface AvitoVaultConfig {
    URL: string;               // e.g. https://api.avito.ru
    CLIENT_ID: string;
    CLIENT_SECRET: string;
}

@Injectable()
export class AvitoApiService {
    private readonly logger = new Logger(AvitoApiService.name);
    private accessToken: string | null = null;
    private accessTokenExpiresAt: number | null = null; // epoch ms

    constructor(
        private readonly http: HttpService,
        private readonly vault: VaultService,
    ) {}

    // Public high-level method (axios-based)
    async request<T = any>(path: string, data?: any, method: HttpVerb = 'post'): Promise<T> {
        const avito = await this.vault.get('avito') as unknown as AvitoVaultConfig;
        const url = this.buildUrl(avito.URL, path);

        // First try with current/refresh token
        let token = await this.getAccessToken(avito, /*forceRefresh*/ false);
        try {
            return await this.makeAxiosRequest<T>(url, method, data, token);
        } catch (err) {
            const axiosErr = err as AxiosError;
            if (this.isUnauthorized(axiosErr)) {
                // Refresh token and retry ONCE
                token = await this.getAccessToken(avito, /*forceRefresh*/ true);
                return await this.makeAxiosRequest<T>(url, method, data, token);
            }
            throw err;
        }
    }

    // Low-level fetch (node fetch) with same 401-once-retry semantics
    async rawFetch<T = any>(path: string, body?: any, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> {
        const avito = await this.vault.get('avito') as unknown as AvitoVaultConfig;
        const url = this.buildUrl(avito.URL, path);

        let token = await this.getAccessToken(avito, false);
        try {
            return await this.makeFetchRequest<T>(url, method, body, token);
        } catch (err: any) {
            if (this.isFetchUnauthorized(err)) {
                token = await this.getAccessToken(avito, true);
                return await this.makeFetchRequest<T>(url, method, body, token);
            }
            throw err;
        }
    }

    private buildUrl(base: string, path: string): string {
        const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
        return path.startsWith('/') ? trimmed + path : `${trimmed}/${path}`;
    }

    private async makeAxiosRequest<T>(url: string, method: HttpVerb, data: any, token: string): Promise<T> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
        };
        // Choose config by method
        const obs = method === 'get'
            ? this.http.get(url, { params: data, headers })
            : this.http.request({ url, method, data, headers });

        return await firstValueFrom(
            obs.pipe(map((res) => res.data as T)),
        );
    }

    private async makeFetchRequest<T>(url: string, method: string, body: any, token: string): Promise<T> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };
        const isGetLike = method === 'GET';
        let fetchUrl = url;
        let fetchOptions: any = { method, headers };

        if (isGetLike && body && Object.keys(body).length > 0) {
            const params = new URLSearchParams();
            for (const [k, v] of Object.entries(body)) params.append(k, String(v));
            fetchUrl += `?${params.toString()}`;
        } else if (!isGetLike) {
            fetchOptions.body = JSON.stringify(body ?? {});
        }

        const res = await fetch(fetchUrl, fetchOptions);
        const text = await res.text();
        let data: any;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = text;
        }

        if (!res.ok) {
            const err: any = new Error(`Avito API error: ${res.status} ${res.statusText}`);
            err.status = res.status;
            err.response = { data, status: res.status, statusText: res.statusText };
            throw err;
        }
        return data as T;
    }

    private isUnauthorized(error: AxiosError | any): boolean {
        const status = (error?.response as any)?.status;
        return status === 401 || status === 403;
    }

    private isFetchUnauthorized(error: any): boolean {
        const status = error?.status ?? error?.response?.status;
        return status === 401 || status === 403;
    }

    // Token management
    private async getAccessToken(cfg: AvitoVaultConfig, forceRefresh: boolean): Promise<string> {
        const now = Date.now();
        const bufferMs = 60_000; // refresh 60s early

        if (!forceRefresh && this.accessToken && this.accessTokenExpiresAt && now + bufferMs < this.accessTokenExpiresAt) {
            return this.accessToken;
        }

        const { token, expiresAt } = await this.fetchNewToken(cfg);
        this.accessToken = token;
        this.accessTokenExpiresAt = expiresAt;
        return token;
    }

    private async fetchNewToken(cfg: AvitoVaultConfig): Promise<{ token: string; expiresAt: number }> {
        // Avito typically uses OAuth2 client_credentials at `${base}/token`
        // grant_type=client_credentials with Basic auth (base64 client_id:client_secret).
        const tokenUrl = this.buildUrl(cfg.URL, '/token');
        const basic = Buffer.from(`${cfg.CLIENT_ID}:${cfg.CLIENT_SECRET}`).toString('base64');

        const obs = this.http.post(
            tokenUrl,
            new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${basic}`,
                },
            },
        );

        try {
            const res = await firstValueFrom(obs);
            const accessToken = (res.data?.access_token ?? res.data?.token) as string;
            const expiresInSec = (res.data?.expires_in as number) ?? 3600;
            if (!accessToken) {
                throw new Error('Avito token response missing access_token');
            }
            const expiresAt = Date.now() + (expiresInSec * 1000);
            return { token: accessToken, expiresAt };
        } catch (e: any) {
            const msg = e?.response?.data?.error_description || e?.message || 'Unknown token error';
            this.logger.error(`Avito token fetch failed: ${msg}`);
            throw e;
        }
    }
}