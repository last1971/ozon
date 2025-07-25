import { MakeDecisionsCommand } from './make-decisions.command';
import { DiscountTaskDto } from '../dto/discount-task-list.dto';
import { ConfigService } from '@nestjs/config';

describe('MakeDecisionsCommand', () => {
  let configService: any;
  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(10) }; // maxDiscountPercent = 10
  });

  it('should approve or decline tasks based on min_price and maxDiscountPercent', async () => {
    const command = new MakeDecisionsCommand(configService);
    const tasks: DiscountTaskDto[] = [
      { id: '1', offer_id: 'a', requested_price: 90, requested_quantity_min: 1, requested_quantity_max: 2, approved_quantity_min: 1, approved_quantity_max: 2, created_at: '', end_at: '', edited_till: '', status: '', customer_name: '', sku: 0, user_comment: '', seller_comment: '', approved_price: 0, original_price: 0, discount: 0, discount_percent: 0, base_price: 0, min_auto_price: 0, prev_task_id: 0, is_damaged: false, moderated_at: '', approved_discount: 0, approved_discount_percent: 0, is_purchased: false, is_auto_moderated: false, email: '', last_name: '', first_name: '', patronymic: '', requested_price_with_fee: 0, approved_price_with_fee: 0, approved_price_fee_percent: 0 },
      { id: '2', offer_id: 'b', requested_price: 50, requested_quantity_min: 1, requested_quantity_max: 2, approved_quantity_min: 1, approved_quantity_max: 2, created_at: '', end_at: '', edited_till: '', status: '', customer_name: '', sku: 0, user_comment: '', seller_comment: '', approved_price: 0, original_price: 0, discount: 0, discount_percent: 0, base_price: 0, min_auto_price: 0, prev_task_id: 0, is_damaged: false, moderated_at: '', approved_discount: 0, approved_discount_percent: 0, is_purchased: false, is_auto_moderated: false, email: '', last_name: '', first_name: '', patronymic: '', requested_price_with_fee: 0, approved_price_with_fee: 0, approved_price_fee_percent: 0 }
    ];
    const pricesMap = new Map([
      ['a', { min_price: '100' }], // minPrice с учётом maxDiscountPercent = 90
      ['b', { min_price: '60' }],  // minPrice с учётом maxDiscountPercent = 54
    ]);
    const context = {
      tasks,
      pricesMap,
      errors: []
    };
    const result = await command.execute(context);
    expect(result.decisions.approveTasks.length).toBe(1); // только первая заявка
    expect(result.decisions.declineTasks.length).toBe(1); // вторая заявка
    expect(result.errors.length).toBe(0);
  });
}); 