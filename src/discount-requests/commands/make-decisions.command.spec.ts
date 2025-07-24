import { MakeDecisionsCommand } from './make-decisions.command';
import { DiscountTaskDto } from '../dto/discount-task-list.dto';

describe('MakeDecisionsCommand', () => {
  it('should approve or decline tasks based on min_price', async () => {
    const command = new MakeDecisionsCommand();
    const tasks: DiscountTaskDto[] = [
      { id: '1', offer_id: 'a', requested_price: 100, requested_quantity_min: 1, requested_quantity_max: 2, approved_quantity_min: 1, approved_quantity_max: 2, created_at: '', end_at: '', edited_till: '', status: '', customer_name: '', sku: 0, user_comment: '', seller_comment: '', approved_price: 0, original_price: 0, discount: 0, discount_percent: 0, base_price: 0, min_auto_price: 0, prev_task_id: 0, is_damaged: false, moderated_at: '', approved_discount: 0, approved_discount_percent: 0, is_purchased: false, is_auto_moderated: false, email: '', last_name: '', first_name: '', patronymic: '', requested_price_with_fee: 0, approved_price_with_fee: 0, approved_price_fee_percent: 0 },
      { id: '2', offer_id: 'b', requested_price: 50, requested_quantity_min: 1, requested_quantity_max: 2, approved_quantity_min: 1, approved_quantity_max: 2, created_at: '', end_at: '', edited_till: '', status: '', customer_name: '', sku: 0, user_comment: '', seller_comment: '', approved_price: 0, original_price: 0, discount: 0, discount_percent: 0, base_price: 0, min_auto_price: 0, prev_task_id: 0, is_damaged: false, moderated_at: '', approved_discount: 0, approved_discount_percent: 0, is_purchased: false, is_auto_moderated: false, email: '', last_name: '', first_name: '', patronymic: '', requested_price_with_fee: 0, approved_price_with_fee: 0, approved_price_fee_percent: 0 }
    ];
    const context = {
      tasks,
      pricesMap: new Map([
        ['a', { min_price: '90' }],
        ['b', { min_price: '60' }]
      ]),
      errors: []
    };
    const result = await command.execute(context);
    expect(result.decisions.approveTasks.length).toBe(1);
    expect(result.decisions.declineTasks.length).toBe(1);
    expect(result.errors.length).toBe(0);
  });
}); 