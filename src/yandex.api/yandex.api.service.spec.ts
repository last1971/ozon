import { Test, TestingModule } from '@nestjs/testing';
import { YandexApiService } from './yandex.api.service';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of, throwError } from 'rxjs';
import { Agent } from 'https';

describe('YandexApiService', () => {
    let service: YandexApiService;
    const get = jest.fn().mockReturnValue(of({ data: 'get' }));
    const put = jest.fn().mockReturnValue(of({ data: 'put' }));
    const post = jest.fn().mockReturnValue(of({ data: 'post' }));

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                YandexApiService,
                { provide: HttpService, useValue: { get, put, post } },
                {
                    provide: VaultService,
                    useValue: {
                        get: async () => ({
                            token: 'token',
                            url: 'url',
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get<YandexApiService>(YandexApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test method', async () => {
        let res = await service.method('1', 'hz', {});
        expect(res).toEqual('get');
        expect(get.mock.calls).toHaveLength(1);
        const httpsAgent = expect.any(Agent);
        expect(get.mock.calls[0]).toEqual(['url1', { headers: { 'Api-Key': 'token' }, params: {}, httpsAgent }]);
        res = await service.method('2', 'put', { put: 1 });
        expect(res).toEqual('put');
        expect(put.mock.calls).toHaveLength(1);
        expect(put.mock.calls[0]).toEqual(['url2', { put: 1 }, { headers: { 'Api-Key': 'token' }, httpsAgent }]);
        res = await service.method('3', 'post', { post: 2 });
        expect(res).toEqual('post');
        expect(post.mock.calls).toHaveLength(1);
        expect(post.mock.calls[0]).toEqual(['url3', { post: 2 }, { headers: { 'Api-Key': 'token' }, httpsAgent }]);
    });

    it('ходит в Яндекс только по IPv4 одним агентом', async () => {
        get.mockClear();
        await service.method('a', 'get', {});
        await service.method('b', 'get', {});
        const [first, second] = get.mock.calls.map((call) => call[1].httpsAgent);
        expect(first).toBe(second);
        expect(first.options).toMatchObject({ family: 4, keepAlive: true });
    });

    it('сетевой сбой без текста — причина из error.code', async () => {
        get.mockReturnValueOnce(throwError(() => Object.assign(new Error(''), { code: 'ETIMEDOUT' })));
        const res = await service.method('orders', 'get', {});
        expect(res.status).toEqual('NotOk');
        expect(res.error.service_message).toEqual('ETIMEDOUT');
    });
});

describe('Яндекс: общая очередь кампании и повторы лимита', () => {
    it('не запускает параллельные запросы кампании, независимо от ручки', async () => {
        let active = 0,
            max = 0;
        const send = jest.fn(
            () =>
                new (require('rxjs').Observable)((subscriber: any) => {
                    active++;
                    max = Math.max(max, active);
                    setImmediate(() => {
                        active--;
                        subscriber.next({ data: { status: 'OK' } });
                        subscriber.complete();
                    });
                }),
        );
        const api = new YandexApiService({ put: send, get: send } as any, { get: async () => ({ url: 'url' }) } as any);
        await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                api.method(`campaigns/1/${i ? 'offers/stocks' : 'orders'}`, i ? 'put' : 'get', {}),
            ),
        );
        expect(max).toBe(1);
        expect(send).toHaveBeenCalledTimes(8);
    });
    it('повторяет 420 rate limit и сохраняет окончательный отказ; 409 не повторяет', async () => {
        jest.useFakeTimers();
        try {
            const send = jest
                .fn()
                .mockReturnValue(
                    throwError(() => ({
                        response: {
                            status: 420,
                            data: { errors: [{ message: 'Hit rate limit of 4 parallel requests' }] },
                        },
                    })),
                );
            const api = new YandexApiService({ put: send } as any, { get: async () => ({ url: 'url' }) } as any);
            const result = api.method('stocks', 'put', {});
            await jest.advanceTimersByTimeAsync(4000);
            expect((await result).status).toBe('NotOk');
            expect(send).toHaveBeenCalledTimes(3);
            send.mockReturnValue(throwError(() => ({ response: { status: 409, data: {} } })));
            expect((await api.method('stocks', 'put', {})).error.status).toBe(409);
            expect(send).toHaveBeenCalledTimes(4);
        } finally {
            jest.useRealTimers();
        }
    });
    it('успешный повтор возвращает реальный ответ', async () => {
        jest.useFakeTimers();
        try {
            const send = jest
                .fn()
                .mockReturnValueOnce(throwError(() => ({ response: { status: 429 } })))
                .mockReturnValueOnce(of({ data: { status: 'OK' } }));
            const api = new YandexApiService({ put: send } as any, { get: async () => ({ url: 'url' }) } as any);
            const result = api.method('stocks', 'put', {});
            await jest.advanceTimersByTimeAsync(2000);
            expect(await result).toEqual({ status: 'OK' });
        } finally {
            jest.useRealTimers();
        }
    });
});
