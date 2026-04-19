import { DeclineDiscountTasksCommand } from './decline-discount-tasks.command';

describe('DeclineDiscountTasksCommand', () => {
  it('should call declineDiscountTask and update declined count', async () => {
    const discountRequestsService = { declineDiscountTask: jest.fn().mockResolvedValue({}) };
    const command = new DeclineDiscountTasksCommand(discountRequestsService as any);
    const context = { decisions: { approveTasks: [], declineTasks: [{ id: '1' }] }, declined: 0, errors: [] };
    const result = await command.execute(context);
    expect(discountRequestsService.declineDiscountTask).toHaveBeenCalledTimes(1);
    expect(result.declined).toBe(1);
  });

  it('should batch tasks by 50 when there are more than 50', async () => {
    const discountRequestsService = { declineDiscountTask: jest.fn().mockResolvedValue({}) };
    const command = new DeclineDiscountTasksCommand(discountRequestsService as any);
    const declineTasks = Array.from({ length: 75 }, (_, i) => ({ id: String(i) }));
    const context = { decisions: { approveTasks: [], declineTasks }, declined: 0, errors: [] };
    const result = await command.execute(context);
    expect(discountRequestsService.declineDiscountTask).toHaveBeenCalledTimes(2);
    expect(discountRequestsService.declineDiscountTask.mock.calls[0][0].tasks).toHaveLength(50);
    expect(discountRequestsService.declineDiscountTask.mock.calls[1][0].tasks).toHaveLength(25);
    expect(result.declined).toBe(75);
  });
}); 