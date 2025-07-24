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
    expect(discountRequestsService.approveDiscountTask).toHaveBeenCalled();
    expect(result.approved).toBe(2);
  });
}); 