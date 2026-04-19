import { ApproveDiscountTasksCommand } from './approve-discount-tasks.command';

describe('ApproveDiscountTasksCommand', () => {
  it('should call approveDiscountTask and update approved count', async () => {
    const discountRequestsService = { approveDiscountTask: jest.fn().mockResolvedValue({}) };
    const command = new ApproveDiscountTasksCommand(discountRequestsService as any);
    const context = { decisions: { approveTasks: [
      { id: '1', approved_price: 100, approved_quantity_min: 1, approved_quantity_max: 2 },
      { id: '2', approved_price: 200, approved_quantity_min: 1, approved_quantity_max: 2 }
    ], declineTasks: [] }, approved: 0, errors: [] };
    const result = await command.execute(context);
    expect(discountRequestsService.approveDiscountTask).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(2);
  });

  it('should batch tasks by 50 when there are more than 50', async () => {
    const discountRequestsService = { approveDiscountTask: jest.fn().mockResolvedValue({}) };
    const command = new ApproveDiscountTasksCommand(discountRequestsService as any);
    const approveTasks = Array.from({ length: 120 }, (_, i) => ({
      id: String(i),
      approved_price: 100,
      approved_quantity_min: 1,
      approved_quantity_max: 1,
    }));
    const context = { decisions: { approveTasks, declineTasks: [] }, approved: 0, errors: [] };
    const result = await command.execute(context);
    expect(discountRequestsService.approveDiscountTask).toHaveBeenCalledTimes(3);
    expect(discountRequestsService.approveDiscountTask.mock.calls[0][0].tasks).toHaveLength(50);
    expect(discountRequestsService.approveDiscountTask.mock.calls[1][0].tasks).toHaveLength(50);
    expect(discountRequestsService.approveDiscountTask.mock.calls[2][0].tasks).toHaveLength(20);
    expect(result.approved).toBe(120);
  });
}); 