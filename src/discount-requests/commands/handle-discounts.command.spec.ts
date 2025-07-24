import { HandleDiscountsCommand } from './handle-discounts.command';

describe('HandleDiscountsCommand', () => {
  it('should call handleDiscounts with originalOfferIds', async () => {
    const extraPriceService = { handleDiscounts: jest.fn() };
    const command = new HandleDiscountsCommand(extraPriceService as any);
    const context = { originalOfferIds: ['a', 'b', 'c'] };
    await command.execute(context);
    expect(extraPriceService.handleDiscounts).toHaveBeenCalledWith(['a', 'b', 'c']);
  });
}); 