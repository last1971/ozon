import { SerialTaskQueue } from '../helpers/serial-task.queue';
import { RateLimitRetryPolicy } from '../helpers/rate-limit.retry.policy';
import { assertPricingRequestAllowed } from '../helpers/price/pricing-review-mode';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { Agent } from 'https';

@Injectable()
export class YandexApiService {
    /**
     * Только IPv4 и постоянные соединения. IPv6 с сервера не маршрутизируется, а Node 20
     * через 250 мс медленного IPv4-коннекта уходит на мёртвый IPv6 и падает ошибкой без текста
     * (с 11.10.2026 коннект к Яндексу временами 1–3 с — десятки пустых «Яндекс orders:» в день).
     */
    private static readonly httpsAgent = new Agent({ family: 4, keepAlive: true });
    private readonly requests = new SerialTaskQueue();
    private readonly retry = new RateLimitRetryPolicy({
        retryHeader: 'retry-after',
        maxRetries: 2,
        maxWaitMs: 30000,
        defaultWaitMs: 2000,
    });
    private logger = new Logger(YandexApiService.name);
    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
    ) {}
    /** Кампания кабинета розницы — для ручек `campaigns/{id}/…`. */
    async campaignId(): Promise<number> {
        const yandexSeller = await this.vaultService.get('yandex-seller');
        return Number(yandexSeller['electronica-company']);
    }

    async method(name: string, method: string, options: any): Promise<any> {
        const yandexSeller = await this.vaultService.get('yandex-seller');
        assertPricingRequestAllowed('yandex', name, method);
        // Общий лимит кампании относится не только к записи остатков.
        return this.requests.run(String(yandexSeller['electronica-company'] ?? yandexSeller.url), async () => {
            for (let attempt = 1; ; attempt++) {
                try {
                    const headers = { 'Api-Key': yandexSeller.token as string };
                    const httpsAgent = YandexApiService.httpsAgent;
                    const url = yandexSeller.url + name;
                    const response =
                        method === 'post'
                            ? this.httpService.post(url, options, { headers, httpsAgent })
                            : method === 'put'
                              ? this.httpService.put(url, options, { headers, httpsAgent })
                              : this.httpService.get(url, { headers, params: options, httpsAgent });
                    return (await firstValueFrom(response)).data;
                } catch (cause) {
                    const error = cause as AxiosError;
                    const rateLimit =
                        error.response?.status === 420 && /Hit rate limit/i.test(JSON.stringify(error.response.data));
                    const wait = this.retry.decide(
                        rateLimit ? { ...error.response, status: 429 } : error.response,
                        attempt,
                    );
                    if (wait !== null) {
                        this.logger.warn(`Яндекс: ограничение запросов ${name}, повтор через ${wait / 1000} с`);
                        await new Promise((resolve) => setTimeout(resolve, wait));
                        continue;
                    }
                    // Яндекс отдаёт причину в `errors[] {code, message}`, а не в `message`:
                    // без разбора массива отказ по коду маркировки приходил как «undefined».
                    const data: any = error?.response?.data ?? {};
                    const errors: { code?: string; message?: string }[] = Array.isArray(data.errors) ? data.errors : [];
                    const message: string =
                        data.message ??
                        (errors.length
                            ? errors.map((e) => [e.code, e.message].filter(Boolean).join(': ')).join('; ')
                            : undefined);
                    // Сетевой сбой (таймаут, отказ коннекта) приходит без ответа и часто с пустым
                    // error.message — тогда причина только в error.code (ETIMEDOUT, ECONNRESET…).
                    const serviceMessage = error?.message || error?.code || 'нет ответа от Яндекса';
                    this.logger.error(`${serviceMessage} ${name}: ${message ?? ''}`);
                    return {
                        result: null,
                        status: 'NotOk',
                        error: {
                            service_message: serviceMessage,
                            message,
                            status: error?.response?.status,
                            errors,
                        },
                    };
                }
            }
        });
    }
}
