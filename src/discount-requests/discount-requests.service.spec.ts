import { Test, TestingModule } from '@nestjs/testing';
import { DiscountRequestsService } from './discount-requests.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { ExtraPriceService } from '../price/extra.price.service';
import { PriceService } from '../price/price.service';
import { GetDiscountTasksCommand } from './commands/get-discount-tasks.command';
import { ExtractOriginalOfferIdsCommand } from './commands/extract-original-offer-ids.command';
import { HandleDiscountsCommand } from './commands/handle-discounts.command';
import { GetPricesMapCommand } from './commands/get-prices-map.command';
import { MakeDecisionsCommand } from './commands/make-decisions.command';
import { ApproveDiscountTasksCommand } from './commands/approve-discount-tasks.command';
import { DeclineDiscountTasksCommand } from './commands/decline-discount-tasks.command';

describe('DiscountRequestsService', () => {
  let service: DiscountRequestsService;
  let ozonApiService: any;
  let extraPriceService: any;
  let priceService: any;
  let getDiscountTasksCommand: any;
  let extractOriginalOfferIdsCommand: any;
  let handleDiscountsCommand: any;
  let getPricesMapCommand: any;
  let makeDecisionsCommand: any;
  let approveDiscountTasksCommand: any;
  let declineDiscountTasksCommand: any;

  beforeEach(async () => {
    ozonApiService = { method: jest.fn(), rawFetch: jest.fn() };
    extraPriceService = {};
    priceService = {};
    getDiscountTasksCommand = { execute: jest.fn(async ctx => ({ ...ctx, tasks: [{ id: 1 }] })) };
    extractOriginalOfferIdsCommand = { execute: jest.fn(async ctx => ({ ...ctx, originalOfferIds: ['1'] })) };
    handleDiscountsCommand = { execute: jest.fn(async ctx => ctx) };
    getPricesMapCommand = { execute: jest.fn(async ctx => ({ ...ctx, pricesMap: new Map([['1', { min_price: '90' }]]) })) };
    makeDecisionsCommand = { execute: jest.fn(async ctx => ({ ...ctx, decisions: { approveTasks: [{ id: '1', approved_price: 90, approved_quantity_min: 1, approved_quantity_max: 2 }], declineTasks: [] } })) };
    approveDiscountTasksCommand = { execute: jest.fn(async ctx => ({ ...ctx, approved: 1 })) };
    declineDiscountTasksCommand = { execute: jest.fn(async ctx => ({ ...ctx, declined: 0 })) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountRequestsService,
        { provide: OzonApiService, useValue: ozonApiService },
        { provide: ExtraPriceService, useValue: extraPriceService },
        { provide: PriceService, useValue: priceService },
        { provide: GetDiscountTasksCommand, useValue: getDiscountTasksCommand },
        { provide: ExtractOriginalOfferIdsCommand, useValue: extractOriginalOfferIdsCommand },
        { provide: HandleDiscountsCommand, useValue: handleDiscountsCommand },
        { provide: GetPricesMapCommand, useValue: getPricesMapCommand },
        { provide: MakeDecisionsCommand, useValue: makeDecisionsCommand },
        { provide: ApproveDiscountTasksCommand, useValue: approveDiscountTasksCommand },
        { provide: DeclineDiscountTasksCommand, useValue: declineDiscountTasksCommand },
      ],
    }).compile();
    service = module.get<DiscountRequestsService>(DiscountRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Оставляем тесты для публичных методов, которые остались
  // getDiscountTasks, approveDiscountTask, declineDiscountTask, getAllUnprocessedDiscountTasks

  it('getDiscountTasks calls OzonApiService and returns result', async () => {
    const params = { status: 'NEW', limit: 10 } as any;
    const apiResult = [{ id: 1 }];
    ozonApiService.rawFetch.mockResolvedValue(apiResult);
    const res = await service.getDiscountTasks(params);
    expect(ozonApiService.rawFetch).toHaveBeenCalledWith('/v1/actions/discounts-task/list', params);
    expect(res).toEqual(apiResult);
  });

  it('approveDiscountTask calls OzonApiService and returns result', async () => {
    const params = { tasks: [{ id: '1', approved_price: 100, approved_quantity_min: 1, approved_quantity_max: 2 }] };
    const apiResult = { success_count: 1, fail_count: 0, fail_details: [] };
    ozonApiService.method.mockResolvedValue(apiResult);
    const res = await service.approveDiscountTask(params);
    expect(ozonApiService.method).toHaveBeenCalledWith('/v1/actions/discounts-task/approve', params, 'post');
    expect(res).toEqual(apiResult);
  });

  it('declineDiscountTask calls OzonApiService and returns result', async () => {
    const params = { tasks: [{ id: '1', seller_comment: 'no' }] };
    const apiResult = { success_count: 0, fail_count: 1, fail_details: [{ task_id: 1, error_for_user: 'error' }] };
    ozonApiService.method.mockResolvedValue(apiResult);
    const res = await service.declineDiscountTask(params);
    expect(ozonApiService.method).toHaveBeenCalledWith('/v1/actions/discounts-task/decline', params, 'post');
    expect(res).toEqual(apiResult);
  });

  it('getAllUnprocessedDiscountTasks returns all NEW tasks with pagination', async () => {
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
    const singlePage = [{ id: 1 }, { id: 2 }];
    ozonApiService.rawFetch.mockResolvedValue({ result: singlePage });
    const res = await service.getAllUnprocessedDiscountTasks();
    expect(ozonApiService.rawFetch).toHaveBeenCalledTimes(1);
    expect(res).toEqual(singlePage);
  });

  describe('autoProcessDiscountRequests', () => {
    it('should process discount requests successfully via pipeline', async () => {
      const result = await service.autoProcessDiscountRequests();
      expect(getDiscountTasksCommand.execute).toHaveBeenCalled();
      expect(extractOriginalOfferIdsCommand.execute).toHaveBeenCalled();
      expect(handleDiscountsCommand.execute).toHaveBeenCalled();
      expect(getPricesMapCommand.execute).toHaveBeenCalled();
      expect(makeDecisionsCommand.execute).toHaveBeenCalled();
      expect(approveDiscountTasksCommand.execute).toHaveBeenCalled();
      expect(declineDiscountTasksCommand.execute).toHaveBeenCalled();
      expect(result).toEqual({ approved: 1, declined: 0, errors: [] });
    });
  });
}); 