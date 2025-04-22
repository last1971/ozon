import { Test, TestingModule } from '@nestjs/testing';
import { Trade2006IncomingService } from './trade2006.incoming.service';
import { FIREBIRD } from '../firebird/firebird.module';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('Trade2006IncomingService', () => {
    let service: Trade2006IncomingService;
    let eventEmitterMock: any;

    beforeEach(async () => {
        eventEmitterMock = {
            emit: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                Trade2006IncomingService,
                {
                    provide: FIREBIRD,
                    useValue: {
                        getTransaction: jest.fn(),
                    },
                },
                {
                    provide: EventEmitter2,
                    useValue: eventEmitterMock,
                },
            ],
        }).compile();

        service = module.get<Trade2006IncomingService>(Trade2006IncomingService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('fetchLastShopInCode', () => {
        it('should fetch last SHOPINCODE on init', async () => {
            const query = jest.fn().mockReturnValue([{ MAX_CODE: 123 }]);
            const mockTransaction = { query };

            jest.spyOn(service, 'withTransaction').mockImplementation((callback: any) => {
                return callback(mockTransaction);
            });

            await service.onModuleInit();

            expect(query).toHaveBeenCalledWith(
                'SELECT MAX(SHOPINCODE) AS MAX_CODE FROM SHOPIN',
                []
            );
            expect((service as any).lastShopInCode).toBe(123);
        });

        it('should handle null MAX_CODE', async () => {
            const query = jest.fn().mockReturnValue([{ MAX_CODE: null }]);
            const mockTransaction = { query };

            jest.spyOn(service, 'withTransaction').mockImplementation((callback: any) => {
                return callback(mockTransaction);
            });

            await service.onModuleInit();

            expect((service as any).lastShopInCode).toBe(0);
        });
    });

    describe('checkNewGoods', () => {
        it('should emit event with array of GOODSCODE when new records found', async () => {
            const newRecords = [
                { SHOPINCODE: 125, GOODSCODE: 'A001' },
                { SHOPINCODE: 126, GOODSCODE: 'B002' },
            ];

            const query = jest.fn().mockReturnValue(newRecords);
            const mockTransaction = { query };

            jest.spyOn(service, 'withTransaction').mockImplementation((callback: any) => {
                return callback(mockTransaction);
            });

            // Установка lastShopInCode
            (service as any).lastShopInCode = 124;

            await service.checkNewGoods();

            expect(query).toHaveBeenCalledWith(
                'SELECT SHOPINCODE, GOODSCODE FROM SHOPIN WHERE SHOPINCODE > ? ORDER BY SHOPINCODE',
                [124]
            );

            expect(eventEmitterMock.emit).toHaveBeenCalledWith(
                'incoming.goods',
                ['A001', 'B002']
            );

            expect((service as any).lastShopInCode).toBe(126);
        });

        it('should not emit event when no new records found', async () => {
            const query = jest.fn().mockReturnValue([]);
            const mockTransaction = { query };

            jest.spyOn(service, 'withTransaction').mockImplementation((callback: any) => {
                return callback(mockTransaction);
            });

            (service as any).lastShopInCode = 124;

            await service.checkNewGoods();

            expect(query).toHaveBeenCalledWith(
                'SELECT SHOPINCODE, GOODSCODE FROM SHOPIN WHERE SHOPINCODE > ? ORDER BY SHOPINCODE',
                [124]
            );

            expect(eventEmitterMock.emit).not.toHaveBeenCalled();
            expect((service as any).lastShopInCode).toBe(124);
        });
    });

    describe('manualCheck', () => {
        it('should call checkNewGoods', async () => {
            const spy = jest.spyOn(service, 'checkNewGoods').mockResolvedValue(undefined);

            await service.manualCheck();

            expect(spy).toHaveBeenCalled();
        });
    });
});