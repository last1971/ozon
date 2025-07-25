import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom, map } from 'rxjs';
import { AxiosError } from 'axios';
import { VaultService } from 'vault-module/lib/vault.service';
import JSONbig from 'json-bigint';

@Injectable()
export class OzonApiService {
    private logger = new Logger(OzonApiService.name);
    constructor(
        private httpService: HttpService,
        private vaultService: VaultService,
    ) {}
    async method(name: string, options: any, httpMethod: 'post' | 'get' = 'post'): Promise<any> {
        const ozon = await this.vaultService.get('ozon');

        const headers = {
            'Client-Id': ozon.CLIENT_ID as string,
            'Api-Key': ozon.API_KEY as string,
        };

//        this.logger.log(`[OZON API REQUEST] ${httpMethod.toUpperCase()} ${ozon.URL + name}`);
//        this.logger.log(`[OZON API REQUEST BODY] ${JSON.stringify(options)}`);
//        this.logger.log(`[OZON API HEADERS] ${JSON.stringify(headers)}`);

        return httpMethod === 'get'
            ? firstValueFrom(
                  this.httpService
                      .get(ozon.URL + name, {
                          params: options,
                          headers,
                      })
                      //.pipe(map((res) => res.data))
                      .pipe(
                          map((res) => {
                             // ЛОГИРУЕМ ОТВЕТ
                             // this.logger.log(`[OZON API RESPONSE] ${res.data}`);
                             return res.data;
                          }),
                          catchError(async (error: AxiosError) => {
                              this.logger.error(error.message + ' ' + error?.response?.data['message']);
                              return {
                                  result: null,
                                  error: { service_message: error.message, message: error?.response?.data['message'] },
                              };
                          }),
                      ),
              )
            : firstValueFrom(
                  this.httpService
                      .post(ozon.URL + name, options, {
                          headers: {
                              'Client-Id': ozon.CLIENT_ID as string,
                              'Api-Key': ozon.API_KEY as string,
                          },
                      })
                      .pipe(map((res) => {
                        // ЛОГИРУЕМ ОТВЕТ
                        // this.logger.log(`[OZON API RESPONSE] ${res.data}`);
                         return res.data;
                      }))
                      .pipe(
                          catchError(async (error: AxiosError) => {
                              this.logger.error(error.message + ' ' + error?.response?.data['message']);
                              return {
                                  result: null,
                                  error: { service_message: error.message, message: error?.response?.data['message'] },
                              };
                          }),
                      ),
              );
    }

    /**
     * Низкоуровневый метод для сырых запросов к Ozon API через стандартный fetch
     */
    async rawFetch(endpoint: string, body: any, method: 'POST' | 'GET' = 'POST'): Promise<any> {
        const ozon = await this.vaultService.get('ozon');
        const url = ozon.URL + endpoint;
        const headers: Record<string, string> = {
            'Client-Id': ozon.CLIENT_ID as string,
            'Api-Key': ozon.API_KEY as string,
            'Content-Type': 'application/json',
        };

        let fetchUrl = url;
        let fetchOptions: any = {
            method,
            headers,
        };

        if (method === 'POST') {
            fetchOptions.body = JSON.stringify(body ?? {});
        } else if (method === 'GET' && body && Object.keys(body).length > 0) {
            // Добавляем query string
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(body)) {
                params.append(key, String(value));
            }
            fetchUrl += '?' + params.toString();
        }

        // this.logger.log(`[OZON RAW FETCH] ${method} ${fetchUrl}`);
        // this.logger.log(`[OZON RAW FETCH BODY] ${JSON.stringify(body)}`);
        // this.logger.log(`[OZON RAW FETCH HEADERS] ${JSON.stringify(headers)}`);

        const response = await fetch(fetchUrl, fetchOptions);
        const text = await response.text();
        let data: any;
        try {
            data = JSONbig({ storeAsString: true }).parse(text);
        } catch {
            data = text;
        }
        if (!response.ok) {
            this.logger.error(`[OZON RAW FETCH ERROR] ${response.status} ${response.statusText}`);
            throw new Error(`Ozon API error: ${response.status} ${response.statusText}`);
        }
        return data;
    }
}
