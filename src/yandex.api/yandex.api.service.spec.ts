import { Test, TestingModule } from '@nestjs/testing';
import { YandexApiService } from './yandex.api.service';
import { HttpService } from '@nestjs/axios';
import { VaultService } from 'vault-module/lib/vault.service';
import { of } from 'rxjs';

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
        expect(get.mock.calls[0]).toEqual(['url1', { headers: { Authorization: 'Bearer token' } }]);
        res = await service.method('2', 'put', { put: 1 });
        expect(res).toEqual('put');
        expect(put.mock.calls).toHaveLength(1);
        expect(put.mock.calls[0]).toEqual(['url2', { put: 1 }, { headers: { Authorization: 'Bearer token' } }]);
        res = await service.method('3', 'post', { post: 2 });
        expect(res).toEqual('post');
        expect(post.mock.calls).toHaveLength(1);
        expect(post.mock.calls[0]).toEqual(['url3', { post: 2 }, { headers: { Authorization: 'Bearer token' } }]);
    });
});
