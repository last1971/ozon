import { Test, TestingModule } from '@nestjs/testing';
import { OzonApiService } from './ozon.api.service';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { VaultService } from 'vault-module/lib/vault.service';

describe('OzonApiService', () => {
    let service: OzonApiService;
    const post = jest.fn().mockReturnValue(of('post'));
    const get = jest.fn().mockReturnValue({ URL: 'get', API_KEY: 'get', CLIENT_ID: 'get' });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OzonApiService,
                { provide: HttpService, useValue: { post } },
                { provide: VaultService, useValue: { get } },
            ],
        }).compile();

        service = module.get<OzonApiService>(OzonApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test method', async () => {
        await service.method('test', { option: 'option ' });
        expect(get.mock.calls[0]).toEqual(['ozon']);
        expect(post.mock.calls[0]).toEqual([
            'gettest',
            { option: 'option ' },
            { headers: { 'Client-Id': 'get', 'Api-Key': 'get' } },
        ]);
    });
});
