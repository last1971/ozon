import { Test, TestingModule } from '@nestjs/testing';
import { OzonApiService } from './ozon.api.service';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { VaultService } from 'vault-module/lib/vault.service';

describe('OzonApiService', () => {
    let service: OzonApiService;
    const post = jest.fn().mockReturnValue(of({ data: 'post' }));
    const get = jest.fn().mockReturnValue(of({ data: 'get' }));
    const vaultGet = jest.fn().mockResolvedValue({ URL: 'get', API_KEY: 'get', CLIENT_ID: 'get' });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OzonApiService,
                { provide: HttpService, useValue: { post, get } },
                { provide: VaultService, useValue: { get: vaultGet } },
            ],
        }).compile();

        service = module.get<OzonApiService>(OzonApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test method with post', async () => {
        await service.method('test', { option: 'option ' });
        expect(vaultGet.mock.calls[0]).toEqual(['ozon']);
        expect(post.mock.calls[0]).toEqual([
            'gettest',
            { option: 'option ' },
            { headers: { 'Client-Id': 'get', 'Api-Key': 'get' } },
        ]);
    });

    it('test method with get', async () => {
        await service.method('test', { option: 'option ' }, 'get');
        expect(vaultGet.mock.calls[0]).toEqual(['ozon']);
        expect(get.mock.calls[0]).toEqual([
            'gettest',
            {
                params: { option: 'option ' },
                headers: { 'Client-Id': 'get', 'Api-Key': 'get' },
            },
        ]);
    });
});
