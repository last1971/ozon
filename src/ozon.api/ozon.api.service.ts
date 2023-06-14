import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { VaultService } from 'vault-module/lib/vault.service';

@Injectable()
export class OzonApiService {
    private logger = new Logger(OzonApiService.name);
    constructor(private httpService: HttpService, private vaultService: VaultService) {}
    async method(name: string, options: any): Promise<any> {
        const ozon = await this.vaultService.get('ozon');
        return firstValueFrom(
            this.httpService
                .post(ozon.URL + name, options, {
                    headers: {
                        'Client-Id': ozon.CLIENT_ID as string,
                        'Api-Key': ozon.API_KEY as string,
                    },
                })
                .pipe(map((res) => res.data))
                .pipe(
                    catchError(async (error: AxiosError) => {
                        this.logger.error(error.message + ' ' + error?.response?.data['message']);
                        return null;
                    }),
                ),
        );
    }
}
