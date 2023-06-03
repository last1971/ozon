import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { VaultService } from '../vault/vault.service';

@Injectable()
export class ElectronicaApiService {
    private logger = new Logger(ElectronicaApiService.name);
    constructor(private httpService: HttpService, private vaultService: VaultService) {}
    async method(name: string, options: any): Promise<any> {
        const electronica = await this.vaultService.get('electronica');
        return firstValueFrom(
            this.httpService
                .get(electronica.URL + name, {
                    headers: {
                        Authorization: 'Bearer ' + electronica.TOKEN,
                    },
                    params: options,
                })
                .pipe(map((res) => res.data))
                .pipe(
                    catchError(async (error: AxiosError) => {
                        this.logger.error(error.message);
                        return null;
                    }),
                ),
        );
    }
}
