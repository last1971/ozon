import { EarlyExitCheckCommand } from './early-exit-check.command';
import { DiscountTaskDto } from '../dto/discount-task-list.dto';

describe('EarlyExitCheckCommand', () => {
  it('should set stopChain if no tasks', async () => {
    const command = new EarlyExitCheckCommand();
    const context = {};
    const result = await command.execute(context);
    expect(result.stopChain).toBe(true);
  });

  it('should set stopChain if tasks.length < threshold', async () => {
    const command = new EarlyExitCheckCommand();
    const tasks: DiscountTaskDto[] = [
      { id: '1', offer_id: '1', created_at: '', end_at: '', edited_till: '', status: '', customer_name: '', sku: 0, user_comment: '', seller_comment: '', requested_price: 0, approved_price: 0, original_price: 0, discount: 0, discount_percent: 0, base_price: 0, min_auto_price: 0, prev_task_id: 0, is_damaged: false, moderated_at: '', approved_discount: 0, approved_discount_percent: 0, is_purchased: false, is_auto_moderated: false, email: '', last_name: '', first_name: '', patronymic: '', approved_quantity_min: 0, approved_quantity_max: 0, requested_quantity_min: 0, requested_quantity_max: 0, requested_price_with_fee: 0, approved_price_with_fee: 0, approved_price_fee_percent: 0 }
    ];
    const context = { tasks, threshold: 2 };
    const result = await command.execute(context);
    expect(result.stopChain).toBe(true);
  });

  it('should not set stopChain if enough tasks', async () => {
    const command = new EarlyExitCheckCommand();
    const tasks: DiscountTaskDto[] = [
      { id: '1', offer_id: '1', created_at: '', end_at: '', edited_till: '', status: '', customer_name: '', sku: 0, user_comment: '', seller_comment: '', requested_price: 0, approved_price: 0, original_price: 0, discount: 0, discount_percent: 0, base_price: 0, min_auto_price: 0, prev_task_id: 0, is_damaged: false, moderated_at: '', approved_discount: 0, approved_discount_percent: 0, is_purchased: false, is_auto_moderated: false, email: '', last_name: '', first_name: '', patronymic: '', approved_quantity_min: 0, approved_quantity_max: 0, requested_quantity_min: 0, requested_quantity_max: 0, requested_price_with_fee: 0, approved_price_with_fee: 0, approved_price_fee_percent: 0 },
      { id: '2', offer_id: '2', created_at: '', end_at: '', edited_till: '', status: '', customer_name: '', sku: 0, user_comment: '', seller_comment: '', requested_price: 0, approved_price: 0, original_price: 0, discount: 0, discount_percent: 0, base_price: 0, min_auto_price: 0, prev_task_id: 0, is_damaged: false, moderated_at: '', approved_discount: 0, approved_discount_percent: 0, is_purchased: false, is_auto_moderated: false, email: '', last_name: '', first_name: '', patronymic: '', approved_quantity_min: 0, approved_quantity_max: 0, requested_quantity_min: 0, requested_quantity_max: 0, requested_price_with_fee: 0, approved_price_with_fee: 0, approved_price_fee_percent: 0 }
    ];
    const context = { tasks, threshold: 2 };
    const result = await command.execute(context);
    expect(result.stopChain).toBe(false);
  });
}); 