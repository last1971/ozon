import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext, IDiscountDecisions } from '../../interfaces/i.discount.processing.context';
import { DiscountTaskDto } from '../dto/discount-task-list.dto';

@Injectable()
export class MakeDecisionsCommand implements ICommandAsync<IDiscountProcessingContext> {
  async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
    const tasks = context.tasks || [];
    const pricesMap = context.pricesMap || new Map();
    const errors = context.errors || [];
    const approveTasks: IDiscountDecisions['approveTasks'] = [];
    const declineTasks: IDiscountDecisions['declineTasks'] = [];

    for (const task of tasks) {
      try {
        const priceData = pricesMap.get(task.offer_id);
        if (!priceData) {
          throw new Error(`Не найдены цены для offer_id: ${task.offer_id}`);
        }
        const minPrice = parseFloat(priceData.min_price);
        const requestedPrice = task.requested_price;
        if (requestedPrice >= minPrice) {
          approveTasks.push({
            id: task.id,
            approved_price: minPrice,
            seller_comment: '',
            approved_quantity_min: task.requested_quantity_min,
            approved_quantity_max: task.requested_quantity_max
          });
        } else {
          declineTasks.push({
            id: task.id,
            seller_comment: ''
          });
        }
      } catch (error: any) {
        errors.push(`Ошибка обработки заявки ${task.id}: ${error.message}`);
      }
    }

    return {
      ...context,
      errors,
      decisions: { approveTasks, declineTasks }
    };
  }
} 