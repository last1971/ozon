import { Test, TestingModule } from '@nestjs/testing';
import { DiscountRequestsService } from './discount-requests.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { DiscountTaskListParamsDto } from './dto/discount-task-list-params.dto';
import { DiscountTaskApproveDto } from './dto/discount-task-approve.dto';
import { DiscountTaskDeclineDto } from './dto/discount-task-decline.dto';
import { DiscountTaskStatus } from './dto/discount-task-status.enum';
import { ExtraPriceService } from '../price/extra.price.service';
import { PriceService } from '../price/price.service';

describe('DiscountRequestsService', () => {
  let service: DiscountRequestsService;
  let ozonApiService: any;
  let extraPriceService: any;
  let priceService: any;

  beforeEach(async () => {
    ozonApiService = { method: jest.fn(), rawFetch: jest.fn() };
    extraPriceService = { handleIncomingGoods: jest.fn() };
    priceService = { index: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountRequestsService,
        { provide: OzonApiService, useValue: ozonApiService },
        { provide: ExtraPriceService, useValue: extraPriceService },
        { provide: PriceService, useValue: priceService },
      ],
    }).compile();
    service = module.get<DiscountRequestsService>(DiscountRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getDiscountTasks calls OzonApiService and returns result', async () => {
    const params: DiscountTaskListParamsDto = { status: 'NEW', limit: 10 } as any;
    const apiResult = [{ id: 1 }];
    ozonApiService.rawFetch.mockResolvedValue(apiResult);
    const res = await service.getDiscountTasks(params);
    expect(ozonApiService.rawFetch).toHaveBeenCalledWith('/v1/actions/discounts-task/list', params);
    expect(res).toEqual(apiResult);
  });

  it('approveDiscountTask calls OzonApiService and returns result', async () => {
    const params: DiscountTaskApproveDto = { tasks: [{ id: "1", approved_price: 100, approved_quantity_min: 1, approved_quantity_max: 2 }] };
    const apiResult = { success_count: 1, fail_count: 0, fail_details: [] };
    ozonApiService.method.mockResolvedValue(apiResult);
    const res = await service.approveDiscountTask(params);
    expect(ozonApiService.method).toHaveBeenCalledWith('/v1/actions/discounts-task/approve', params, 'post');
    expect(res).toEqual(apiResult);
  });

  it('declineDiscountTask calls OzonApiService and returns result', async () => {
    const params: DiscountTaskDeclineDto = { tasks: [{ id: "1", seller_comment: 'no' }] };
    const apiResult = { success_count: 0, fail_count: 1, fail_details: [{ task_id: 1, error_for_user: 'error' }] };
    ozonApiService.method.mockResolvedValue(apiResult);
    const res = await service.declineDiscountTask(params);
    expect(ozonApiService.method).toHaveBeenCalledWith('/v1/actions/discounts-task/decline', params, 'post');
    expect(res).toEqual(apiResult);
  });

  it('getAllUnprocessedDiscountTasks returns all NEW tasks with pagination', async () => {
    // Первая страница - 50 записей (есть ещё)
    const firstPage = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
    const secondPage = [{ id: 51 }, { id: 52 }];
    ozonApiService.rawFetch
      .mockResolvedValueOnce({ result: firstPage })
      .mockResolvedValueOnce({ result: secondPage });
    const res = await service.getAllUnprocessedDiscountTasks();
    expect(ozonApiService.rawFetch).toHaveBeenCalledTimes(2);
    expect(res).toEqual([...firstPage, ...secondPage]);
  });

  it('getAllUnprocessedDiscountTasks handles single page correctly', async () => {
    // Только одна страница с 50 записями
    const singlePage = [{ id: 1 }, { id: 2 }];
    ozonApiService.rawFetch.mockResolvedValue({ result: singlePage });
    const res = await service.getAllUnprocessedDiscountTasks();
    expect(ozonApiService.rawFetch).toHaveBeenCalledTimes(1);
    expect(res).toEqual(singlePage);
  });

  it('extractOriginalOfferIds strips suffixes and deduplicates', () => {
    const tasks = [
      { offer_id: '123-1' },
      { offer_id: '123-2' },
      { offer_id: '456' },
      { offer_id: '123' },
      { offer_id: '456-7' },
    ];
    // @ts-ignore
    const result = (service as any).extractOriginalOfferIds(tasks);
    expect(result).toEqual(['123', '456']);
  });
}); 

describe('autoProcessDiscountRequests', () => {
  let service: DiscountRequestsService;
  let ozonApiService: any;
  let extraPriceService: any;
  let priceService: any;

  beforeEach(async () => {
    extraPriceService = { handleIncomingGoods: jest.fn() };
    priceService = { index: jest.fn() };
    // Создаём instance OzonApiService с замоканными методами
    ozonApiService = new OzonApiService({} as any, {} as any);
    jest.spyOn(ozonApiService, 'method').mockImplementation(jest.fn());
    jest.spyOn(ozonApiService, 'rawFetch').mockImplementation(jest.fn());
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountRequestsService,
        { provide: OzonApiService, useValue: ozonApiService },
        { provide: ExtraPriceService, useValue: extraPriceService },
        { provide: PriceService, useValue: priceService },
      ],
    }).compile();
    service = module.get<DiscountRequestsService>(DiscountRequestsService);
  });

  it('should process discount requests successfully', async () => {
    jest.spyOn(service as any, 'processIncomingGoods').mockResolvedValue({
      tasks: [{ id: 1, offer_id: '123', requested_price: 100, requested_quantity_min: 1, requested_quantity_max: 2 }],
      pricesMap: new Map([['123', { min_price: '90' }]])
    });
    jest.spyOn(service as any, 'executeDecisions').mockResolvedValue({ approved: 1, declined: 0 });
    jest.spyOn(service as any, 'makeDecisions').mockReturnValue({ approveTasks: [{ id: 1, approved_price: 90, approved_quantity_min: 1, approved_quantity_max: 2 }], declineTasks: [] });
    const result = await service.autoProcessDiscountRequests();
    expect(result).toEqual({ approved: 1, declined: 0, errors: [] });
  });

  it('should handle no tasks', async () => {
    jest.spyOn(service as any, 'processIncomingGoods').mockResolvedValue({ tasks: [], pricesMap: new Map() });
    const result = await service.autoProcessDiscountRequests();
    expect(result).toEqual({ approved: 0, declined: 0, errors: [] });
  });

  it('should handle errors', async () => {
    jest.spyOn(service as any, 'processIncomingGoods').mockRejectedValue(new Error('fail'));
    const result = await service.autoProcessDiscountRequests();
    expect(result.errors[0]).toMatch(/fail/);
  });
}); 