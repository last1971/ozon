import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceService } from './performance.service';
import { VaultService } from 'vault-module/lib/vault.service';
import { HttpWrapperService } from '../helpers/http/http-wrapper.service';
import { ConfigService } from '@nestjs/config';

describe('PerformanceService', () => {
    let service: PerformanceService;
    let httpWrapper: HttpWrapperService;
    let vaultService: VaultService;
    let configService: ConfigService;

    const mockOzonConfig = {
        PERFOMANCE_URL: 'https://api.ozon.ru',
        PERFOMANCE_CLIENT_ID: 'test-client-id',
        PERFOMANCE_CLIENT_SECRET: 'test-client-secret',
    };

    const mockToken = 'test-token';
    const mockTokenResponse = {
        result: { access_token: mockToken },
        error: null,
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PerformanceService,
                {
                    provide: HttpWrapperService,
                    useValue: {
                        request: jest.fn(),
                    },
                },
                {
                    provide: VaultService,
                    useValue: {
                        get: jest.fn().mockResolvedValue(mockOzonConfig),
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn().mockImplementation((key: string) => {
                            if (key === 'MAX_DAILY_SPEND') return 1000;
                            return null;
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get<PerformanceService>(PerformanceService);
        httpWrapper = module.get<HttpWrapperService>(HttpWrapperService);
        vaultService = module.get<VaultService>(VaultService);
        configService = module.get<ConfigService>(ConfigService);

        // Инициализация сервиса
        await service['onModuleInit']();
    });

    describe('Token Management', () => {
        it('should get new token when no token exists', async () => {
            jest.spyOn(httpWrapper, 'request').mockResolvedValue(mockTokenResponse);

            const token = await service['getToken']();
            expect(token).toBe(mockToken);
            expect(httpWrapper.request).toHaveBeenCalledWith(
                'post',
                expect.stringContaining('/api/client/token'),
                expect.any(Object),
            );
        });

        it('should return existing token if it is still valid', async () => {
            // Получаем первый токен
            jest.spyOn(httpWrapper, 'request').mockResolvedValue(mockTokenResponse);
            await service['getToken']();

            // Сбрасываем мок для проверки, что второй запрос не будет сделан
            jest.spyOn(httpWrapper, 'request').mockClear();

            // Получаем токен второй раз
            const token = await service['getToken']();
            expect(token).toBe(mockToken);
            expect(httpWrapper.request).not.toHaveBeenCalled();
        });

        it('should get new token if existing token is expired', async () => {
            // Получаем первый токен
            jest.spyOn(httpWrapper, 'request').mockResolvedValue(mockTokenResponse);
            await service['getToken']();

            // Имитируем истечение срока действия токена
            jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 21 * 60 * 1000);

            // Получаем новый токен
            const token = await service['getToken']();
            expect(token).toBe(mockToken);
            expect(httpWrapper.request).toHaveBeenCalledTimes(2);
        });

        it('should handle token request error', async () => {
            jest.spyOn(httpWrapper, 'request').mockResolvedValue({
                result: null,
                error: { message: 'Token request failed' },
            });

            const token = await service['getToken']();
            expect(token).toBeNull();
        });
    });

    describe('Campaign Management', () => {
        beforeEach(() => {
            jest.spyOn(httpWrapper, 'request').mockResolvedValue(mockTokenResponse);
        });

        it('should activate campaign successfully', async () => {
            const campaignId = 123;
            jest.spyOn(httpWrapper, 'request')
                .mockResolvedValueOnce(mockTokenResponse)
                .mockResolvedValueOnce({ result: {}, error: null });

            const result = await service.activateCampaign(campaignId);
            expect(result).toBe(true);
            expect(httpWrapper.request).toHaveBeenCalledWith(
                'post',
                expect.stringContaining(`/campaign/${campaignId}/activate`),
                expect.any(Object),
            );
        });

        it('should deactivate campaign successfully', async () => {
            const campaignId = 123;
            jest.spyOn(httpWrapper, 'request')
                .mockResolvedValueOnce(mockTokenResponse)
                .mockResolvedValueOnce({ result: {}, error: null });

            const result = await service.deactivateCampaign(campaignId);
            expect(result).toBe(true);
            expect(httpWrapper.request).toHaveBeenCalledWith(
                'post',
                expect.stringContaining(`/campaign/${campaignId}/deactivate`),
                expect.any(Object),
            );
        });

        it('should handle campaign activation error', async () => {
            const campaignId = 123;
            jest.spyOn(httpWrapper, 'request')
                .mockResolvedValueOnce(mockTokenResponse)
                .mockResolvedValueOnce({ result: null, error: { message: 'Activation failed' } });

            const result = await service.activateCampaign(campaignId);
            expect(result).toBe(false);
        });

        it('should handle campaign deactivation error', async () => {
            const campaignId = 123;
            jest.spyOn(httpWrapper, 'request')
                .mockResolvedValueOnce(mockTokenResponse)
                .mockResolvedValueOnce({ result: null, error: { message: 'Deactivation failed' } });

            const result = await service.deactivateCampaign(campaignId);
            expect(result).toBe(false);
        });
    });

    describe('Campaign Statistics', () => {
        const mockCampaignData = {
            rows: [
                {
                    id: '1',
                    title: 'Test Campaign 1',
                    date: '2024-03-20',
                    views: '100',
                    clicks: '10',
                    moneySpent: '100,00',
                    avgBid: '10,00',
                    orders: '1',
                    ordersMoney: '1000',
                },
                {
                    id: '2',
                    title: 'Test Campaign 2',
                    date: '2024-03-20',
                    views: '200',
                    clicks: '20',
                    moneySpent: '200,00',
                    avgBid: '10,00',
                    orders: '2',
                    ordersMoney: '2000',
                },
            ],
        };

        beforeEach(() => {
            jest.spyOn(httpWrapper, 'request').mockResolvedValue(mockTokenResponse);
        });

        it('should get campaign expense successfully', async () => {
            const campaignIds = [123, 456];
            const dateFrom = '2024-03-20';
            const dateTo = '2024-03-21';

            jest.spyOn(httpWrapper, 'request')
                .mockResolvedValueOnce(mockTokenResponse)
                .mockResolvedValueOnce({ result: mockCampaignData, error: null });

            const result = await service.getCampaignExpense(campaignIds, dateFrom, dateTo);
            expect(result).toEqual({
                rows: [
                    {
                        id: '1',
                        title: 'Test Campaign 1',
                        date: '2024-03-20',
                        views: '100',
                        clicks: '10',
                        moneySpent: 100,
                        avgBid: 10,
                        orders: '1',
                        ordersMoney: '1000',
                    },
                    {
                        id: '2',
                        title: 'Test Campaign 2',
                        date: '2024-03-20',
                        views: '200',
                        clicks: '20',
                        moneySpent: 200,
                        avgBid: 10,
                        orders: '2',
                        ordersMoney: '2000',
                    },
                ],
            });
            expect(httpWrapper.request).toHaveBeenCalledWith(
                'get',
                expect.stringContaining('/statistics/daily/json'),
                expect.objectContaining({
                    params: {
                        campaignIds: campaignIds.join(','),
                        dateFrom,
                        dateTo,
                    },
                }),
            );
        });

        it('should get today money spent successfully', async () => {
            const campaignIds = [123, 456];
            const today = new Date().toISOString().split('T')[0];

            jest.spyOn(httpWrapper, 'request')
                .mockResolvedValueOnce(mockTokenResponse)
                .mockResolvedValueOnce({ result: mockCampaignData, error: null });

            const result = await service.getTodayMoneySpent(campaignIds);
            expect(result).toBe(300); // 100 + 200
            expect(httpWrapper.request).toHaveBeenCalledWith(
                'get',
                expect.stringContaining('/statistics/daily/json'),
                expect.objectContaining({
                    params: {
                        campaignIds: campaignIds.join(','),
                        dateFrom: today,
                        dateTo: today,
                    },
                }),
            );
        });

        it('should handle campaign expense error', async () => {
            const campaignIds = [123, 456];
            const dateFrom = '2024-03-20';
            const dateTo = '2024-03-21';

            jest.spyOn(httpWrapper, 'request')
                .mockResolvedValueOnce(mockTokenResponse)
                .mockResolvedValueOnce({ result: null, error: { message: 'Failed to get expense' } });

            const result = await service.getCampaignExpense(campaignIds, dateFrom, dateTo);
            expect(result).toEqual({ rows: [] });
        });
    });

    describe('Campaign Cron Jobs', () => {
        beforeEach(() => {
            jest.spyOn(httpWrapper, 'request').mockResolvedValue(mockTokenResponse);
            service['ozon'] = {
                PERFOMACE_CAMPAIGN_IDS: '123,456,789'
            };
        });

        describe('getCampaignIds', () => {
            it('should return array of valid campaign IDs', async () => {
                service['ozon'] = {
                    PERFOMACE_CAMPAIGN_IDS: '123,456,789'
                };
                const ids = await service['getCampaignIds']();
                expect(ids).toEqual([123, 456, 789]);
            });

            it('should filter out invalid IDs', async () => {
                service['ozon'] = {
                    PERFOMACE_CAMPAIGN_IDS: '123,abc,456,789'
                };
                const ids = await service['getCampaignIds']();
                expect(ids).toEqual([123, 456, 789]);
            });

            it('should return empty array for empty string', async () => {
                service['ozon'] = {
                    PERFOMACE_CAMPAIGN_IDS: ''
                };
                const ids = await service['getCampaignIds']();
                expect(ids).toEqual([]);
            });

            it('should return empty array if PERFOMACE_CAMPAIGN_IDS is undefined', async () => {
                service['ozon'] = {};
                const ids = await service['getCampaignIds']();
                expect(ids).toEqual([]);
            });
        });

        describe('enablePlanedCampaigns', () => {
            it('should activate all campaigns from config', async () => {
                jest.spyOn(service, 'activateCampaign').mockResolvedValue(true);

                await service.enablePlanedCampaigns();

                expect(service.activateCampaign).toHaveBeenCalledTimes(3);
                expect(service.activateCampaign).toHaveBeenCalledWith(123);
                expect(service.activateCampaign).toHaveBeenCalledWith(456);
                expect(service.activateCampaign).toHaveBeenCalledWith(789);
            });

            it('should handle empty campaign list', async () => {
                service['ozon'] = {
                    PERFOMACE_CAMPAIGN_IDS: ''
                };
                const activateSpy = jest.spyOn(service, 'activateCampaign').mockResolvedValue(true);

                await service.enablePlanedCampaigns();

                expect(activateSpy).not.toHaveBeenCalled();
            });
        });

        describe('checkAndDeactivateCampaigns', () => {
            it('should deactivate campaigns exceeding spend limit', async () => {
                jest.spyOn(service, 'getTodayMoneySpent')
                    .mockResolvedValueOnce(1500) // превышает лимит
                    .mockResolvedValueOnce(500)  // в пределах лимита
                    .mockResolvedValueOnce(2000); // превышает лимит
                jest.spyOn(service, 'deactivateCampaign').mockResolvedValue(true);

                await service.checkAndDeactivateCampaigns();

                expect(service.deactivateCampaign).toHaveBeenCalledTimes(2);
                expect(service.deactivateCampaign).toHaveBeenCalledWith(123);
                expect(service.deactivateCampaign).toHaveBeenCalledWith(789);
                expect(service.deactivateCampaign).not.toHaveBeenCalledWith(456);
            });

            it('should handle empty campaign list', async () => {
                service['ozon'] = {
                    PERFOMACE_CAMPAIGN_IDS: ''
                };
                const getSpentSpy = jest.spyOn(service, 'getTodayMoneySpent').mockResolvedValue(0);
                const deactivateSpy = jest.spyOn(service, 'deactivateCampaign').mockResolvedValue(true);

                await service.checkAndDeactivateCampaigns();

                expect(getSpentSpy).not.toHaveBeenCalled();
                expect(deactivateSpy).not.toHaveBeenCalled();
            });

            it('should use default max spend if not configured', async () => {
                jest.spyOn(configService, 'get').mockReturnValue(null);
                jest.spyOn(service, 'getTodayMoneySpent').mockResolvedValue(1500);
                jest.spyOn(service, 'deactivateCampaign').mockResolvedValue(true);

                await service.checkAndDeactivateCampaigns();

                expect(service.deactivateCampaign).toHaveBeenCalled();
            });
        });
    });
}); 