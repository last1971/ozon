import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class HttpWrapperService {
    private readonly logger: Logger;

    constructor(private readonly httpService: HttpService) {
        this.logger = new Logger(HttpWrapperService.name);
    }

    async request<T = any>(
        method: 'get' | 'post' | 'put',
        url: string,
        options: {
            data?: any;
            params?: any;
            headers?: Record<string, string>;
        } = {},
    ): Promise<{ result: T | null; error?: any }> {
        try {
            const { data, params, headers = {} } = options;
            let response;

            switch (method) {
                case 'get':
                    response = await firstValueFrom(
                        this.httpService.get(url, { params, headers })
                    );
                    break;
                case 'post':
                    response = await firstValueFrom(
                        this.httpService.post(url, data, { headers })
                    );
                    break;
                case 'put':
                    response = await firstValueFrom(
                        this.httpService.put(url, data, { headers })
                    );
                    break;
            }

            return { result: response.data };
        } catch (error) {
            const err = error as AxiosError;
            const errorDetails = {
                service_message: err.message,
                message: err?.response?.data?.['message'],
                status: err?.response?.status,
                statusText: err?.response?.statusText,
                data: err?.response?.data,
                url: err.config?.url,
            };

            this.logger.error(
                `[${method.toUpperCase()}] ${url}: ${err.message}`,
                {
                    error: errorDetails,
                    request: {
                        method,
                        url,
                        params: options.params,
                        data: options.data,
                    },
                },
            );

            return {
                result: null,
                error: errorDetails,
            };
        }
    }
} 