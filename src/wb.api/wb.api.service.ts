import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { catchError, firstValueFrom, map, Observable } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';

@Injectable()
export class WbApiService {
    private logger: Logger;
    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
    ) {
        this.logger = new Logger(WbApiService.name);
    }
    async method(name: string, method: string, options: any, fullName = false): Promise<any> {
        const wb = await this.vaultService.get('wildberries');
        const url = fullName ? name : (method === 'statistics' ? wb.STATISTICS_URL : wb.URL) + name;
        let response: Observable<AxiosResponse>;
        const headers = {
            Authorization: `${(method === 'statistics' ? wb.STATISTICS_TOKEN : wb.API_TOKEN) as string}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        };
        switch (method) {
            case 'post':
                response = this.httpService.post(url, options, { headers });
                break;
            case 'put':
                response = this.httpService.put(url, options, { headers });
                break;
            default:
                response = this.httpService.get(url, {
                    headers,
                    params: options,
                });
        }
        return firstValueFrom(
            response.pipe(map((res) => res.data)).pipe(
                catchError(async (error: AxiosError) => {
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
