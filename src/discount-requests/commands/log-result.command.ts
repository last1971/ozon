import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';

@Injectable()
export class LogResultCommand implements ICommandAsync<IDiscountProcessingContext> {
    async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
        if (context.logger) {
            context.logger.log(`Заявок апрувлено: ${context.approved ?? 0}`);
            context.logger.log(`Заявок отклонено: ${context.declined ?? 0}`);
            if (context.errors && context.errors.length > 0) {
                context.logger.log(`Ошибки: ${context.errors.join('; ')}`);
            }
        }
        return context;
    }
}
