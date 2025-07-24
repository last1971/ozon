import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';
import { DiscountRequestsService } from '../discount-requests.service';

@Injectable()
export class ApproveDiscountTasksCommand implements ICommandAsync<IDiscountProcessingContext> {
    constructor(
        @Inject(forwardRef(() => DiscountRequestsService))
        private readonly discountRequestsService: DiscountRequestsService,
    ) {}

    async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
        const approveTasks = context.decisions?.approveTasks || [];
        let approved = context.approved || 0;
        const errors = context.errors || [];
        if (approveTasks.length > 0) {
            try {
                await this.discountRequestsService.approveDiscountTask({ tasks: approveTasks });
                approved += approveTasks.length;
            } catch (error: any) {
                errors.push(`Ошибка при апруве заявок: ${error.message}`);
            }
        }
        return { ...context, approved, errors };
    }
}
