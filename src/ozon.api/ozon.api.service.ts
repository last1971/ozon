import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class OzonApiService {
    private logger = new Logger(OzonApiService.name);
    constructor(private httpService: HttpService, private configService: ConfigService) {}
    method(name: string, options: any): Promise<any> {
        return firstValueFrom(
            this.httpService
                .post(this.configService.get<string>('OZON_URL', 'https://api-seller.ozon.ru') + name, options, {
                    headers: {
                        'Client-Id': this.configService.get<string>('CLIENT-ID', ''),
                        'Api-Key': this.configService.get<string>('API-KEY', ''),
                    },
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
