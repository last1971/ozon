import { Test, TestingModule } from '@nestjs/testing';
import { WbApiService } from './wb.api.service';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of, throwError } from 'rxjs';
import { RateLimitRetryPolicy } from '../helpers/rate-limit.retry.policy';

describe('WbApiService', () => {
    let service: WbApiService;

    const get = jest.fn().mockReturnValue(of({ data: 'get' }));
    const put = jest.fn().mockReturnValue(of({ data: 'put' }));
    const post = jest.fn().mockReturnValue(of({ data: 'post' }));

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WbApiService,
                { provide: RateLimitRetryPolicy, useValue: new RateLimitRetryPolicy(RateLimitRetryPolicy.WB) },
                {
                    provide: HttpService,
                    useValue: { get, put, post },
                },
                {
                    provide: VaultService,
                    useValue: {
                        get: () => ({
                            API_TOKEN: 'token',
                            URL: 'url',
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get<WbApiService>(WbApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('method', async () => {
        let res = await service.method('1', 'hz', {});
        expect(res).toEqual('get');
        expect(get.mock.calls).toHaveLength(1);
        expect(get.mock.calls[0]).toEqual([
            'url1',
            {
                headers: { Authorization: 'token', Accept: 'application/json', 'Content-Type': 'application/json' },
                params: {},
            },
        ]);
        res = await service.method('2', 'put', { put: 1 });
        expect(res).toEqual('put');
        expect(put.mock.calls).toHaveLength(1);
        expect(put.mock.calls[0]).toEqual([
            'url2',
            { put: 1 },
            { headers: { Authorization: 'token', Accept: 'application/json', 'Content-Type': 'application/json' } },
        ]);
        res = await service.method('3', 'post', { post: 2 });
        expect(res).toEqual('post');
        expect(post.mock.calls).toHaveLength(1);
        expect(post.mock.calls[0]).toEqual([
            'url3',
            { post: 2 },
            { headers: { Authorization: 'token', Accept: 'application/json', 'Content-Type': 'application/json' } },
        ]);
        res = await service.method('4', 'statistics', { post: 2 });
        expect(res).toEqual('get');
        expect(get.mock.calls).toHaveLength(2);
        expect(get.mock.calls[1]).toEqual([
            'undefined4',
            {
                headers: { Authorization: 'token', Accept: 'application/json', 'Content-Type': 'application/json' },
                params: { post: 2 },
            },
        ]);
        res = await service.method('5', 'post', { post: 2 }, true);
        expect(res).toEqual('post');
        expect(post.mock.calls).toHaveLength(2);
        expect(post.mock.calls[1]).toEqual([
            '5',
            { post: 2 },
            {
                headers: { Authorization: 'token', Accept: 'application/json', 'Content-Type': 'application/json' },
            },
        ]);
    });

    describe('429 — повтор по политике', () => {
        const limited = (retry: string) => ({
            message: 'Request failed with status code 429',
            response: {
                status: 429,
                statusText: 'Too Many Requests',
                headers: { 'x-ratelimit-retry': retry },
                data: {},
            },
            config: { url: 'url/api/v3/stocks/1', method: 'post' },
        });

        it('первый ответ 429 → ждём по заголовку и повторяем тот же запрос; наружу — данные', async () => {
            post.mockReset()
                .mockReturnValueOnce(throwError(() => limited('0')))
                .mockReturnValueOnce(of({ data: { stocks: [1] } }));

            const res = await service.method('/api/v3/stocks/1', 'post', { chrtIds: [1] });

            expect(res).toEqual({ stocks: [1] });
            expect(post).toHaveBeenCalledTimes(2);
            expect(post.mock.calls[1][1]).toEqual({ chrtIds: [1] });
        });

        it('повторный 429 → сдаёмся: прежняя форма ошибки с retryAfterMs, запросов ровно два', async () => {
            post.mockReset().mockReturnValue(throwError(() => limited('0')));

            const res = await service.method('/api/v3/stocks/1', 'post', {});

            expect(post).toHaveBeenCalledTimes(2);
            expect(res).toMatchObject({ result: null, status: 'NotOk', error: { status: 429, retryAfterMs: 0 } });
        });

        it('ждать дольше потолка не будем — ошибка сразу, без повтора', async () => {
            post.mockReset().mockReturnValue(throwError(() => limited('120')));

            const res = await service.method('/api/v3/stocks/1', 'post', {});

            expect(post).toHaveBeenCalledTimes(1);
            expect(res).toMatchObject({ status: 'NotOk', error: { status: 429, retryAfterMs: 120000 } });
        });

        it('не 429 → без повтора, как раньше', async () => {
            post.mockReset().mockReturnValue(
                throwError(() => ({ message: 'boom', response: { status: 500, data: { message: 'x' } }, config: {} })),
            );
            const res = await service.method('/x', 'post', {});
            expect(post).toHaveBeenCalledTimes(1);
            expect(res).toMatchObject({ status: 'NotOk', error: { status: 500, message: 'x' } });
        });
    });
});
