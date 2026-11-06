import { RateLimitRetryPolicy } from '../helpers/rate-limit.retry.policy';
import { waitRateLimit } from '../helpers/decorators/rate-limit.decorator';
import { assertPricingRequestAllowed } from '../helpers/price/pricing-review-mode';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { VaultService } from 'vault-module/lib/vault.service';
import JSONbig from 'json-bigint';
import { formatAxiosError } from '../helpers/http/format-axios-error';

@Injectable()
export class OzonApiService {
    private logger = new Logger(OzonApiService.name);
    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
    ) {}
    async method(name: string, options: any, httpMethod: 'post' | 'get' = 'post'): Promise<any> {
        assertPricingRequestAllowed('ozon', name, httpMethod);
        const ozon = await this.vaultService.get('ozon');

        const headers = {
            'Client-Id': ozon.CLIENT_ID as string,
            'Api-Key': ozon.API_KEY as string,
            'Content-Type': 'application/json',
        };

        for (let attempt = 1; ; attempt++) {
            await this.limit(name, String(ozon.CLIENT_ID));
            try {
                const request =
                    httpMethod === 'get'
                        ? this.httpService.get(ozon.URL + name, { params: options, headers })
                        : this.httpService.post(ozon.URL + name, options, { headers });
                return (await firstValueFrom(request)).data;
            } catch (error) {
                const wait = this.retryPolicy.decide(error.response, attempt);
                if (wait === null)
                    return this.handleApiError(error, ozon.URL + name, httpMethod.toUpperCase(), options, headers);
                this.logger.warn(`Ozon: лимит ${name}, повтор через ${wait / 1000} с`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
    }

    private readonly retryPolicy = new RateLimitRetryPolicy({
        retryHeader: 'retry-after',
        maxRetries: 2,
        maxWaitMs: 30000,
        defaultWaitMs: 5000,
    });

    private async limit(endpoint: string, client: string) {
        if (endpoint === '/v1/product/info/stocks-by-warehouse/fbo')
            await waitRateLimit(`ozon:${client}:${endpoint}`, 1000);
    }

    /** GET файла по готовой ссылке Озона (PDF этикетки) как Buffer. Ссылка публичная — ключи API не шлём. */
    async download(url: string): Promise<Buffer> {
        try {
            return await firstValueFrom(
                this.httpService.get(url, { responseType: 'arraybuffer' }).pipe(map((res) => Buffer.from(res.data))),
            );
        } catch (error) {
            // Тело ошибки тоже arraybuffer — декодируем, чтобы отдать причину, а не 500.
            const data = (error as AxiosError)?.response?.data as any;
            let body = '';
            try {
                body = data ? Buffer.from(data).toString('utf8') : '';
            } catch {
                body = String(data ?? '');
            }
            const status = (error as AxiosError)?.response?.status;
            this.logger.error(`download ${url} failed: ${status ?? ''} ${body || (error as Error).message}`);
            const err = new Error(body || (error as AxiosError).message) as Error & { status?: number };
            err.status = status;
            throw err;
        }
    }

    private handleApiError(error: AxiosError, url: string, method: string, body: any, _headers: any) {
        const responseData = error?.response?.data;

        this.logger.error(formatAxiosError(error, { url, method, body }));

        return {
            result: null,
            error: { service_message: error.message, message: responseData?.['message'] || responseData },
        };
    }

    /**
     * Низкоуровневый метод для сырых запросов к Ozon API через стандартный fetch
     */
    async rawFetch(endpoint: string, body: any, method: 'POST' | 'GET' = 'POST'): Promise<any> {
        assertPricingRequestAllowed('ozon', endpoint, method);
        const ozon = await this.vaultService.get('ozon');
        const url = ozon.URL + endpoint;
        const headers: Record<string, string> = {
            'Client-Id': ozon.CLIENT_ID as string,
            'Api-Key': ozon.API_KEY as string,
            'Content-Type': 'application/json',
        };

        let fetchUrl = url;
        const fetchOptions: any = {
            method,
            headers,
        };

        if (method === 'POST') {
            fetchOptions.body = JSON.stringify(body ?? {});
        } else if (method === 'GET' && body && Object.keys(body).length > 0) {
            // Добавляем query string
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(body)) {
                params.append(key, String(value));
            }
            fetchUrl += '?' + params.toString();
        }

        // this.logger.log(`[OZON RAW FETCH] ${method} ${fetchUrl}`);
        // this.logger.log(`[OZON RAW FETCH BODY] ${JSON.stringify(body)}`);
        // this.logger.log(`[OZON RAW FETCH HEADERS] ${JSON.stringify(headers)}`);

        let response: Response;
        for (let attempt = 1; ; attempt++) {
            await this.limit(endpoint, String(ozon.CLIENT_ID));
            response = await fetch(fetchUrl, fetchOptions);
            const wait = this.retryPolicy.decide(
                {
                    status: response.status,
                    headers: response.headers
                        ? { 'retry-after': response.headers.get('retry-after') ?? undefined }
                        : {},
                },
                attempt,
            );
            if (wait === null) break;
            await response.text();
            await new Promise((resolve) => setTimeout(resolve, wait));
        }
        const text = await response.text();
        let data: any;
        try {
            data = JSONbig({ storeAsString: true }).parse(text);
        } catch {
            data = text;
        }
        if (!response.ok) {
            this.logger.error(`[OZON RAW FETCH ERROR] ${response.status} ${response.statusText}`);
            throw new Error(`Ozon API error: ${response.status} ${response.statusText}`);
        }
        return data;
    }
}
