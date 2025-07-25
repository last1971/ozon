import { DeclineDiscountTasksCommand } from './decline-discount-tasks.command';

describe('DeclineDiscountTasksCommand', () => {
  it('should call declineDiscountTask and update declined count', async () => {
    const discountRequestsService = { declineDiscountTask: jest.fn().mockResolvedValue({}) };
    const command = new DeclineDiscountTasksCommand(discountRequestsService as any);
    const context = { decisions: { approveTasks: [], declineTasks: [{ id: '1' }] }, declined: 0, errors: [] };
    const result = await command.execute(context);
    expect(discountRequestsService.declineDiscountTask).toHaveBeenCalled();
    expect(result.declined).toBe(1);
  });
}); 