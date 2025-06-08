import { Test, TestingModule } from '@nestjs/testing';
import { HttpWrapperService } from './http-wrapper.service';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';

describe('HttpWrapperService', () => {
    let service: HttpWrapperService;
    let httpService: HttpService;

    const mockHttpService = {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                HttpWrapperService,
                {
                    provide: HttpService,
                    useValue: mockHttpService,
                },
            ],
        }).compile();

        service = module.get<HttpWrapperService>(HttpWrapperService);
        httpService = module.get<HttpService>(HttpService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('request', () => {
        const testUrl = 'http://test.com';
        const testData = { test: 'data' };
        const testParams = { param: 'value' };
        const testHeaders = { 'Content-Type': 'application/json' };
        const mockResponse: AxiosResponse = {
            data: { result: 'success' },
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {} as any,
        };

        it('should make successful GET request', async () => {
            mockHttpService.get.mockReturnValue(of(mockResponse));

            const result = await service.request('get', testUrl, {
                params: testParams,
                headers: testHeaders,
            });

            expect(mockHttpService.get).toHaveBeenCalledWith(testUrl, {
                params: testParams,
                headers: testHeaders,
            });
            expect(result).toEqual({ result: mockResponse.data });
        });

        it('should make successful POST request', async () => {
            mockHttpService.post.mockReturnValue(of(mockResponse));

            const result = await service.request('post', testUrl, {
                data: testData,
                headers: testHeaders,
            });

            expect(mockHttpService.post).toHaveBeenCalledWith(testUrl, testData, {
                headers: testHeaders,
            });
            expect(result).toEqual({ result: mockResponse.data });
        });

        it('should make successful PUT request', async () => {
            mockHttpService.put.mockReturnValue(of(mockResponse));

            const result = await service.request('put', testUrl, {
                data: testData,
                headers: testHeaders,
            });

            expect(mockHttpService.put).toHaveBeenCalledWith(testUrl, testData, {
                headers: testHeaders,
            });
            expect(result).toEqual({ result: mockResponse.data });
        });

        it('should handle GET request error', async () => {
            const errorMessage = 'Network Error';
            const errorResponse = {
                message: 'API Error',
                status: 500,
            };

            const axiosError = new AxiosError(
                errorMessage,
                'ERROR',
                {} as any,
                {},
                {
                    status: 500,
                    data: errorResponse,
                } as any,
            );

            mockHttpService.get.mockReturnValue(throwError(() => axiosError));

            const result = await service.request('get', testUrl, {
                params: testParams,
                headers: testHeaders,
            });

            expect(result).toEqual({
                result: null,
                error: {
                    service_message: errorMessage,
                    message: errorResponse.message,
                    status: 500,
                    statusText: undefined,
                    data: errorResponse,
                    url: undefined,
                },
            });
        });

        it('should handle POST request error', async () => {
            const errorMessage = 'Network Error';
            const errorResponse = {
                message: 'API Error',
                status: 500,
            };

            const axiosError = new AxiosError(
                errorMessage,
                'ERROR',
                {} as any,
                {},
                {
                    status: 500,
                    data: errorResponse,
                } as any,
            );

            mockHttpService.post.mockReturnValue(throwError(() => axiosError));

            const result = await service.request('post', testUrl, {
                data: testData,
                headers: testHeaders,
            });

            expect(result).toEqual({
                result: null,
                error: {
                    service_message: errorMessage,
                    message: errorResponse.message,
                    status: 500,
                    statusText: undefined,
                    data: errorResponse,
                    url: undefined,
                },
            });
        });
    });
}); 