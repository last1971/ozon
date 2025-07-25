import { GetDiscountTasksCommand } from './get-discount-tasks.command';

describe('GetDiscountTasksCommand', () => {
  it('should fetch tasks and put them in context', async () => {
    const mockTasks = [{ id: '1' }, { id: '2' }];
    const discountRequestsService = { getAllUnprocessedDiscountTasks: jest.fn().mockResolvedValue(mockTasks) };
    const command = new GetDiscountTasksCommand(discountRequestsService as any);
    const context = {};
    const result = await command.execute(context);
    expect(result.tasks).toEqual(mockTasks);
    expect(discountRequestsService.getAllUnprocessedDiscountTasks).toHaveBeenCalled();
  });
}); 