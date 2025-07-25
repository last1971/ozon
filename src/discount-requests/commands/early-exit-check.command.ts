import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';

@Injectable()
export class EarlyExitCheckCommand implements ICommandAsync<IDiscountProcessingContext> {
    async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
        let reason = '';
        if (!context.tasks) {
            reason = 'Нет задач для обработки';
        } else if (typeof context.threshold === 'number' && context.tasks.length < context.threshold) {
            reason = `Количество задач (${context.tasks.length}) меньше порога threshold (${context.threshold})`;
        } else if (context.stopChain) {
            reason = 'stopChain уже выставлен';
        }
        if (reason) {
            if (context.logger) {
                context.logger.log(`Досрочный выход из цепочки: ${reason}`);
            }
            return { ...context, stopChain: true };
        }
        return { ...context, stopChain: false };
    }
}
