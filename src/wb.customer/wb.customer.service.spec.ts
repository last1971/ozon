import { Test, TestingModule } from '@nestjs/testing';
import { WbCustomerService } from './wb.customer.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { clearRateLimitCache } from '../helpers/decorators/rate-limit.decorator';

describe('WbCustomerService', () => {
    let service: WbCustomerService;
    const mockMethod = jest.fn();

    beforeEach(async () => {
        clearRateLimitCache();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WbCustomerService,
                {
                    provide: WbApiService,
                    useValue: {
                        method: mockMethod,
                    },
                },
            ],
        }).compile();

        service = module.get<WbCustomerService>(WbCustomerService);
        mockMethod.mockClear();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should get claims with correct parameters', async () => {
        const mockResponse = {
            claims: [
                {
                    id: 'fe3e9337-e9f9-423c-8930-946a8ebef80',
                    claim_type: 1,
                    status: 2,
                    status_ex: 8,
                    nm_id: 196320101,
                    user_comment: 'Длина провода не соответствует описанию',
                    wb_comment: 'Продавец одобрил вашу заявку на возврат',
                    dt: '2024-03-26T17:06:12.245611',
                    imt_name: 'Кабель 0.5 м, 3797',
                    order_dt: '2020-10-27T05:18:56',
                    dt_update: '2024-05-10T18:01:06.999613',
                    photos: [],
                    video_paths: [],
                    actions: [],
                    price: 157,
                    currency_code: '643',
                    srid: 'v5o_7143225816503318733.0.0',
                },
            ],
            total: 1,
        };

        mockMethod.mockResolvedValue(mockResponse);

        const query = {
            is_archive: false,
            limit: 50,
            offset: 0,
        };

        const result = await service.getClaims(query);

        expect(mockMethod).toHaveBeenCalledWith(
            'https://returns-api.wildberries.ru/api/v1/claims',
            'get',
            query,
            true,
        );
        expect(result).toEqual(mockResponse);
        expect(result.claims).toHaveLength(1);
        expect(result.total).toBe(1);
    });

    it('should get claims by nm_id', async () => {
        const mockResponse = {
            claims: [],
            total: 0,
        };

        mockMethod.mockResolvedValue(mockResponse);

        const query = {
            is_archive: false,
            nm_id: 196320101,
        };

        const result = await service.getClaims(query);

        expect(mockMethod).toHaveBeenCalledWith(
            'https://returns-api.wildberries.ru/api/v1/claims',
            'get',
            query,
            true,
        );
        expect(result.claims).toHaveLength(0);
    });

    it('should get archived claims', async () => {
        const mockResponse = {
            claims: [],
            total: 0,
        };

        mockMethod.mockResolvedValue(mockResponse);

        const query = {
            is_archive: true,
        };

        await service.getClaims(query);

        expect(mockMethod).toHaveBeenCalledWith(
            'https://returns-api.wildberries.ru/api/v1/claims',
            'get',
            query,
            true,
        );
    });

    it('should get claim by id from active claims', async () => {
        const mockClaim = {
            id: 'fe3e9337-e9f9-423c-8930-946a8ebef80',
            claim_type: 1,
            status: 2,
            status_ex: 8,
            nm_id: 196320101,
            user_comment: 'Test comment',
            wb_comment: null,
            dt: '2024-03-26T17:06:12.245611',
            imt_name: 'Test product',
            order_dt: '2020-10-27T05:18:56',
            dt_update: '2024-05-10T18:01:06.999613',
            photos: [],
            video_paths: [],
            actions: [],
            price: 157,
            currency_code: '643',
            srid: 'v5o_7143225816503318733.0.0',
        };

        mockMethod.mockResolvedValueOnce({ claims: [mockClaim], total: 1 });

        const result = await service.getClaimById('fe3e9337-e9f9-423c-8930-946a8ebef80');

        expect(result).toEqual(mockClaim);
        expect(mockMethod).toHaveBeenCalledTimes(1);
        expect(mockMethod).toHaveBeenCalledWith(
            'https://returns-api.wildberries.ru/api/v1/claims',
            'get',
            { is_archive: false, id: 'fe3e9337-e9f9-423c-8930-946a8ebef80' },
            true,
        );
    });

    it('should get claim by id from archived claims if not found in active', async () => {
        const mockClaim = {
            id: 'archived-claim-id',
            claim_type: 1,
            status: 2,
            status_ex: 10,
            nm_id: 123456,
            user_comment: 'Archived claim',
            wb_comment: null,
            dt: '2024-01-01T12:00:00',
            imt_name: 'Archived product',
            order_dt: '2023-12-01T12:00:00',
            dt_update: '2024-01-10T12:00:00',
            photos: [],
            video_paths: [],
            actions: [],
            price: 100,
            currency_code: '643',
            srid: 'archived-srid',
        };

        mockMethod.mockResolvedValueOnce({ claims: [], total: 0 });
        mockMethod.mockResolvedValueOnce({ claims: [mockClaim], total: 1 });

        const result = await service.getClaimById('archived-claim-id');

        expect(result).toEqual(mockClaim);
        expect(mockMethod).toHaveBeenCalledTimes(2);
    });

    it('should return null if claim not found', async () => {
        mockMethod.mockResolvedValue({ claims: [], total: 0 });

        const result = await service.getClaimById('non-existent-id');

        expect(result).toBeNull();
        expect(mockMethod).toHaveBeenCalledTimes(2);
    });
});
