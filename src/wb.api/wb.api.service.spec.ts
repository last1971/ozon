import { Test, TestingModule } from '@nestjs/testing';
import { WbApiService } from './wb.api.service';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of } from 'rxjs';

describe('WbApiService', () => {
    let service: WbApiService;

    const get = jest.fn().mockReturnValue(of({ data: 'get' }));
    const put = jest.fn().mockReturnValue(of({ data: 'put' }));
    const post = jest.fn().mockReturnValue(of({ data: 'post' }));

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WbApiService,
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
                headers: { Authorization: 'undefined', Accept: 'application/json', 'Content-Type': 'application/json' },
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
});
