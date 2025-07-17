import { Test, TestingModule } from '@nestjs/testing';
import { DiscountRequestsService } from './discount-requests.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { DiscountTaskListParamsDto } from './dto/discount-task-list-params.dto';
import { DiscountTaskApproveDto } from './dto/discount-task-approve.dto';
import { DiscountTaskDeclineDto } from './dto/discount-task-decline.dto';

describe('DiscountRequestsService', () => {
  let service: DiscountRequestsService;
  let ozonApiService: OzonApiService;

  const mockOzonApiService = {
    method: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountRequestsService,
        { provide: OzonApiService, useValue: mockOzonApiService },
      ],
    }).compile();

    service = module.get<DiscountRequestsService>(DiscountRequestsService);
    ozonApiService = module.get<OzonApiService>(OzonApiService);
    mockOzonApiService.method.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getDiscountTasks calls OzonApiService and returns result', async () => {
    const params: DiscountTaskListParamsDto = { status: 'NEW', limit: 10 } as any;
    const apiResult = { result: [{ id: 1 }] };
    mockOzonApiService.method.mockResolvedValue(apiResult);
    const res = await service.getDiscountTasks(params);
    expect(mockOzonApiService.method).toHaveBeenCalledWith('/v1/actions/discounts-task/list', params, 'post');
    expect(res).toEqual(apiResult.result);
  });

  it('approveDiscountTask calls OzonApiService and returns result', async () => {
    const params: DiscountTaskApproveDto = { tasks: [{ id: 1, approved_price: 100, approved_quantity_min: 1, approved_quantity_max: 2 }] };
    const apiResult = { success_count: 1, fail_count: 0, fail_details: [] };
    mockOzonApiService.method.mockResolvedValue(apiResult);
    const res = await service.approveDiscountTask(params);
    expect(mockOzonApiService.method).toHaveBeenCalledWith('/v1/actions/discounts-task/approve', params, 'post');
    expect(res).toEqual(apiResult);
  });

  it('declineDiscountTask calls OzonApiService and returns result', async () => {
    const params: DiscountTaskDeclineDto = { tasks: [{ id: 1, seller_comment: 'no' }] };
    const apiResult = { success_count: 0, fail_count: 1, fail_details: [{ task_id: 1, error_for_user: 'error' }] };
    mockOzonApiService.method.mockResolvedValue(apiResult);
    const res = await service.declineDiscountTask(params);
    expect(mockOzonApiService.method).toHaveBeenCalledWith('/v1/actions/discounts-task/decline', params, 'post');
    expect(res).toEqual(apiResult);
  });
}); 