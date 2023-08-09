import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { catchError, firstValueFrom, map, Observable } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';

@Injectable()
export class YandexApiService {
    private logger = new Logger(YandexApiService.name);
    constructor(private httpService: HttpService, private vaultService: VaultService) {}
    async method(name: string, method: string, options: any): Promise<any> {
        const yandexSeller = await this.vaultService.get('yandex-seller');
        let response: Observable<AxiosResponse>;
        const headers = {
            Authorization: `Bearer ${yandexSeller.token as string}`,
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
                    const hz = options;
                    this.logger.error(error.message + ' ' + error?.response?.data['message']);
                    return {
                        result: null,
                        status: 'NotOk',
                        error: { service_message: error.message, message: error?.response?.data['message'] },
                    };
                }),
            ),
        );
    }
}
