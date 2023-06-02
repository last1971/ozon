import { Test, TestingModule } from '@nestjs/testing';
import { ElectronicaApiService } from './electronica.api.service';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of } from 'rxjs';

describe('ElectronicaApiService', () => {
    let service: ElectronicaApiService;
    let http: HttpService;
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [HttpModule],
            providers: [ElectronicaApiService, ConfigService],
        }).compile();

        service = module.get<ElectronicaApiService>(ElectronicaApiService);
        http = module.get<HttpService>(HttpService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    it('test get', async () => {
        const result: AxiosResponse = {
            data: {
                test: 'Test',
            },
            status: 200,
            statusText: 'OK',
            headers: {},
            config: null,
        };
        jest.spyOn(http, 'get').mockImplementationOnce(() => of(result));
        const response = await service.method('123', {});
        expect(response).toEqual(result.data);
    });
});
