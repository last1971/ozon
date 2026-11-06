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
            httpService.get.mockReturnValueOnce(throwError(() => error401)).mockReturnValueOnce(of(dataResponse));

            const result = await service.method('/test', 'get');

            expect(result).toEqual({ result: 'ok' });
            expect(httpService.post).toHaveBeenCalledTimes(2);
        });
    });
});

describe('Sylius: конфликт записи остатков 409', () => {
    const conflict = (status = 409, detail = 'The optimistic lock on an entity failed.') => ({
        message: `Request failed with status code ${status}`,
        response: { status, data: { detail } },
    });
    const make = () => {
        const http = {
            post: jest.fn().mockReturnValue(of({ data: { token: 'test-token' } })),
            request: jest.fn(),
            get: jest.fn(),
        };
        const service = new SyliusApiService(
            http as any,
            { get: (key, fallback) => (key === 'SYLIUS_URL' ? 'http://site' : fallback) } as any,
        );
        jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
        const log = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});
        return { http, service, log };
    };
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('ограниченный повтор конфликта; следующая запись ждёт и сохраняет более новое значение', async () => {
        const { http, service } = make();
        http.request.mockReturnValueOnce(throwError(() => conflict())).mockReturnValue(of({ data: { updated: 1 } }));
        const first = service.method('/api/v2/admin/stock/update', 'post', { goods: { '123': 4 } });
        const next = service.method('/api/v2/admin/stock/update', 'post', { goods: { '123': 2 } });
        await jest.advanceTimersByTimeAsync(249);
        expect(http.request).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(await first).toEqual({ updated: 1 });
        expect(await next).toEqual({ updated: 1 });
        expect(http.request.mock.calls.map((c) => c[0].data.goods['123'])).toEqual([4, 4, 2]);
    });
    it('после двух повторов возвращает ошибку с адресом, ответом и артикулами; очередь освобождается', async () => {
        const { http, service, log } = make();
        const error = conflict();
        http.request.mockReturnValue(throwError(() => error));
        const result = service.method('/api/v2/admin/stock/update', 'post', { goods: { '547151': 2 } });
        const assertion = expect(result).rejects.toBe(error);
        await jest.advanceTimersByTimeAsync(750);
        await assertion;
        expect(http.request).toHaveBeenCalledTimes(3);
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/stock\/update.*409.*optimistic lock.*547151/));
        http.request.mockReturnValue(of({ data: { updated: 1 } }));
        expect(await service.method('/api/v2/admin/stock/update', 'post', { goods: { '547151': 0 } })).toEqual({
            updated: 1,
        });
    });
    it.each([
        ['/api/v2/admin/stock/update', conflict(409, 'Another conflict')],
        ['/api/v2/admin/stock/update', conflict(500)],
        ['/api/v2/admin/other', conflict()],
        ['/api/v2/admin/stock/update', { message: 'timeout', code: 'ETIMEDOUT' }],
    ])('не повторяет неподтверждённый конфликт или сбой %s', async (path, error) => {
        const { http, service } = make();
        http.request.mockReturnValue(throwError(() => error));
        await expect(service.method(path, 'post', { goods: { '123': 2 } })).rejects.toBe(error);
        expect(http.request).toHaveBeenCalledTimes(1);
    });
    it('сохраняет обновление токена один раз и пишет причину ошибки повторного запроса', async () => {
        const { http, service, log } = make();
        http.request
            .mockReturnValueOnce(throwError(() => conflict(401)))
            .mockReturnValueOnce(throwError(() => conflict(400, 'bad goods')));
        await expect(
            service.method('/api/v2/admin/stock/update', 'post', { goods: { '123': 2 } }),
        ).rejects.toMatchObject({ response: { status: 400 } });
        expect(http.post).toHaveBeenCalledTimes(2);
        expect(http.request).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('bad goods'));
    });
});
