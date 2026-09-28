import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { catchError, firstValueFrom, map, Observable } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';

@Injectable()
export class YandexApiService {
    private logger = new Logger(YandexApiService.name);
    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
    ) {}
    async method(name: string, method: string, options: any): Promise<any> {
        const yandexSeller = await this.vaultService.get('yandex-seller');
        let response: Observable<AxiosResponse>;
        const headers = {
            'Api-Key': yandexSeller.token as string,
        };
        switch (method) {
            case 'post':
                response = this.httpService.post(yandexSeller.url + name, options, { headers });
                break;
            case 'put':
                response = this.httpService.put(yandexSeller.url + name, options, { headers });
                break;
            default:
                response = this.httpService.get(yandexSeller.url + name, { headers, params: options });
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
                    this.logger.error(`${error.message} ${name}: ${message ?? ''}`);
                    return {
                        result: null,
                        status: 'NotOk',
                        error: {
                            service_message: error.message,
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
