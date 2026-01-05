import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { SyliusApiService } from './sylius.api.service';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

describe('SyliusApiService', () => {
    let service: SyliusApiService;
    let httpService: jest.Mocked<HttpService>;
    let configService: jest.Mocked<ConfigService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SyliusApiService,
                {
                    provide: HttpService,
                    useValue: {
                        get: jest.fn(),
                        post: jest.fn(),
                        request: jest.fn(),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<SyliusApiService>(SyliusApiService);
        httpService = module.get(HttpService);
        configService = module.get(ConfigService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('method', () => {
        beforeEach(() => {
            configService.get.mockImplementation((key: string) => {
                const config = {
                    SYLIUS_URL: 'http://localhost',
                    SYLIUS_EMAIL: 'test@test.com',
                    SYLIUS_PASSWORD: 'password',
                    SYLIUS_TOKEN_TTL: 3600,
                };
                return config[key];
            });
        });

        it('should fetch token and make GET request', async () => {
            const tokenResponse: AxiosResponse = {
                data: { token: 'test-token' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            const dataResponse: AxiosResponse = {
                data: { 'hydra:member': [{ code: '123', onHand: 10 }] },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            httpService.post.mockReturnValueOnce(of(tokenResponse));
            httpService.get.mockReturnValueOnce(of(dataResponse));

            const result = await service.method('/api/v2/admin/product-variants', 'get', { page: 1 });

            expect(result).toEqual({ 'hydra:member': [{ code: '123', onHand: 10 }] });
            expect(httpService.post).toHaveBeenCalledWith(
                'http://localhost/api/v2/admin/administrators/token',
                { email: 'test@test.com', password: 'password' },
                expect.any(Object),
            );
        });

        it('should make POST request', async () => {
            const tokenResponse: AxiosResponse = {
                data: { token: 'test-token' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            const dataResponse: AxiosResponse = {
                data: { updated: 5 },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            httpService.post.mockReturnValueOnce(of(tokenResponse));
            httpService.request.mockReturnValueOnce(of(dataResponse));

            const result = await service.method('/api/v2/admin/stock/update', 'post', { goods: { '123': 10 } });

            expect(result).toEqual({ updated: 5 });
        });

        it('should reuse token if not expired', async () => {
            const tokenResponse: AxiosResponse = {
                data: { token: 'test-token' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            const dataResponse: AxiosResponse = {
                data: { result: 'ok' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            httpService.post.mockReturnValue(of(tokenResponse));
            httpService.get.mockReturnValue(of(dataResponse));

            await service.method('/test', 'get');
            await service.method('/test', 'get');

            // Token should be fetched only once
            expect(httpService.post).toHaveBeenCalledTimes(1);
        });

        it('should refresh token on 401 error', async () => {
            const tokenResponse: AxiosResponse = {
                data: { token: 'new-token' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            const dataResponse: AxiosResponse = {
                data: { result: 'ok' },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {} as any,
            };

            const error401 = { response: { status: 401 } };

            httpService.post.mockReturnValue(of(tokenResponse));
            httpService.get
                .mockReturnValueOnce(throwError(() => error401))
                .mockReturnValueOnce(of(dataResponse));

            const result = await service.method('/test', 'get');

            expect(result).toEqual({ result: 'ok' });
            expect(httpService.post).toHaveBeenCalledTimes(2);
        });
    });
});
