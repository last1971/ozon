import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { catchError, firstValueFrom, map, Observable } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { Agent } from 'https';

@Injectable()
export class YandexApiService {
    /**
     * Только IPv4 и постоянные соединения. IPv6 с сервера не маршрутизируется, а Node 20
     * через 250 мс медленного IPv4-коннекта уходит на мёртвый IPv6 и падает ошибкой без текста
     * (с 11.10.2026 коннект к Яндексу временами 1–3 с — десятки пустых «Яндекс orders:» в день).
     */
    private static readonly httpsAgent = new Agent({ family: 4, keepAlive: true });
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
        let response: Observable<AxiosResponse>;
        const headers = {
            'Api-Key': yandexSeller.token as string,
        };
        const httpsAgent = YandexApiService.httpsAgent;
        switch (method) {
            case 'post':
                response = this.httpService.post(yandexSeller.url + name, options, { headers, httpsAgent });
                break;
            case 'put':
                response = this.httpService.put(yandexSeller.url + name, options, { headers, httpsAgent });
                break;
            default:
                response = this.httpService.get(yandexSeller.url + name, { headers, params: options, httpsAgent });
        }
        return firstValueFrom(
            response.pipe(map((res) => res.data)).pipe(
                catchError(async (error: AxiosError) => {
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
                }),
            ),
        );
    }
}
