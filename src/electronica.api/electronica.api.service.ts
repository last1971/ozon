import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class ElectronicaApiService {
    private logger = new Logger(ElectronicaApiService.name);
    constructor(private httpService: HttpService, private configService: ConfigService) {}
    method(name: string, options: any): Promise<any> {
        return firstValueFrom(
            this.httpService
                .get(this.configService.get<string>('ELECTRONICA_URL', 'https:/electronica.su') + name, {
                    headers: {
                        Authorization: 'Bearer ' + this.configService.get<string>('ELECTRONICA_TOKEN', ''),
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
