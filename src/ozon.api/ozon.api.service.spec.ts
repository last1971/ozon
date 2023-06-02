import { Test, TestingModule } from '@nestjs/testing';
import { OzonApiService } from './ozon.api.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';

describe('OzonApiService', () => {
    let service: OzonApiService;
    const post = jest.fn().mockReturnValue(of('post'));
    const get = jest.fn().mockReturnValue('get');

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OzonApiService,
                { provide: HttpService, useValue: { post } },
                { provide: ConfigService, useValue: { get } },
            ],
        }).compile();

        service = module.get<OzonApiService>(OzonApiService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('test method', async () => {
        await service.method('test', { option: 'option ' });
        expect(get.mock.calls).toEqual([
            ['OZON_URL', 'https://api-seller.ozon.ru'],
            ['CLIENT-ID', ''],
            ['API-KEY', ''],
        ]);
        expect(post.mock.calls[0]).toEqual([
            'gettest',
            { option: 'option ' },
            { headers: { 'Client-Id': 'get', 'Api-Key': 'get' } },
        ]);
    });
});
