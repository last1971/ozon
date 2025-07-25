import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext, IDiscountDecisions } from '../../interfaces/i.discount.processing.context';
import { DiscountTaskDto } from '../dto/discount-task-list.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MakeDecisionsCommand implements ICommandAsync<IDiscountProcessingContext> {
    constructor(private readonly configService: ConfigService) {}
    async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
        const tasks = context.tasks || [];
        const pricesMap = context.pricesMap || new Map();
        const errors = context.errors || [];
        const approveTasks: IDiscountDecisions['approveTasks'] = [];
        const declineTasks: IDiscountDecisions['declineTasks'] = [];
        const maxDiscountPercent = this.configService.get<number>('MAX_DISCOUNT_PERCENT', 0);

        for (const task of tasks) {
            try {
                const priceData = pricesMap.get(task.offer_id);
                if (!priceData) {
                    throw new Error(`Не найдены цены для offer_id: ${task.offer_id}`);
                }
                const minPrice = parseFloat(priceData.min_price) * (1 - maxDiscountPercent / 100);
                const requestedPrice = task.requested_price;
                if (requestedPrice >= minPrice) {
                    approveTasks.push({
                        id: task.id,
                        approved_price: minPrice,
                        seller_comment: '',
                        approved_quantity_min: task.requested_quantity_min,
                        approved_quantity_max: task.requested_quantity_max,
                    });
                } else {
                    declineTasks.push({
                        id: task.id,
                        seller_comment: '',
                    });
                }
            } catch (error: any) {
                errors.push(`Ошибка обработки заявки ${task.id}: ${error.message}`);
            }
        }

        return {
            ...context,
            errors,
            decisions: { approveTasks, declineTasks },
        };
    }
}
