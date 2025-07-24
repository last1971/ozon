import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';
import { DiscountRequestsService } from '../discount-requests.service';

@Injectable()
export class DeclineDiscountTasksCommand implements ICommandAsync<IDiscountProcessingContext> {
    constructor(
        @Inject(forwardRef(() => DiscountRequestsService))
        private readonly discountRequestsService: DiscountRequestsService,
    ) {}

    async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
        const declineTasks = context.decisions?.declineTasks || [];
        let declined = context.declined || 0;
        const errors = context.errors || [];
        if (declineTasks.length > 0) {
            try {
                await this.discountRequestsService.declineDiscountTask({ tasks: declineTasks });
                declined += declineTasks.length;
            } catch (error: any) {
                errors.push(`Ошибка при реджекте заявок: ${error.message}`);
            }
        }
        return { ...context, declined, errors };
    }
}
