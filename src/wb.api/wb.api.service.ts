import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { firstValueFrom, Observable } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { RateLimitRetryPolicy } from '../helpers/rate-limit.retry.policy';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Единственная дверь к API ВБ. Отправляет запрос и разбирает ответ; при 429 спрашивает политику повтора
 * (RateLimitRetryPolicy) и, если она велит, ждёт и отправляет тот же запрос ещё раз. Повторять безопасно:
 * 429 означает, что ВБ запрос не принял. Паузы между вызовами — дело @RateLimit на методах выше.
 */
@Injectable()
export class WbApiService {
    private logger: Logger;
    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
        private retryPolicy: RateLimitRetryPolicy,
    ) {
        this.logger = new Logger(WbApiService.name);
    }

    async method(name: string, method: string, options: any, fullName = false): Promise<any> {
        const wb = await this.vaultService.get('wildberries');
        const url = fullName ? name : (method === 'statistics' ? wb.STATISTICS_URL : wb.URL) + name;
        const headers = {
            Authorization: `${wb.API_TOKEN as string}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        };
        for (let attempt = 1; ; attempt++) {
            try {
                return (await firstValueFrom(this.send(url, method, options, headers))).data;
            } catch (e) {
                const error = e as AxiosError<any>;
                const wait = this.retryPolicy.decide(error.response, attempt);
                if (wait === null) return this.failure(error);
                this.logger.warn(
                    `ВБ: лимит на ${error.config?.method?.toUpperCase() ?? method} ${url} — жду ${Math.round(wait / 1000)} с и повторяю`,
                );
                await sleep(wait);
            }
        }
    }

    private send(
        url: string,
        method: string,
        options: any,
        headers: Record<string, string>,
    ): Observable<AxiosResponse> {
        switch (method) {
            case 'post':
                return this.httpService.post(url, options, { headers });
            case 'put':
                return this.httpService.put(url, options, { headers });
            default:
                return this.httpService.get(url, { headers, params: options });
        }
    }

    /** Ошибка после всех попыток — в лог и наружу в прежней форме { result: null, status: 'NotOk', error }. */
    private failure(error: AxiosError<any>) {
        const status = error.response?.status;
        const retryAfterMs = status === 429 ? this.retryPolicy.retryAfterMs(error.response) : undefined;
        this.logger.error('WB API Error:', {
            message: error.message,
            status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            url: error.config?.url,
            method: error.config?.method,
            params: error.config?.params,
            body: error.config?.data,
            retryAfterMs,
        });
        return {
            result: null,
            status: 'NotOk',
            error: {
                service_message: error.message,
                message: error?.response?.data?.['message'],
                status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                url: error.config?.url,
                retryAfterMs,
            },
        };
    }
}
