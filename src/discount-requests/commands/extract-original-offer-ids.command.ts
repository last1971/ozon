import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';

@Injectable()
export class ExtractOriginalOfferIdsCommand implements ICommandAsync<IDiscountProcessingContext> {
  async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
    const tasks = context.tasks || [];
    const originalOfferIds = tasks.map(task => {
      const offerId = task.offer_id;
      return offerId.includes('-') ? offerId.split('-')[0] : offerId;
    });
    // Убираем дубли
    const uniqueOfferIds = Array.from(new Set(originalOfferIds));
    return { ...context, originalOfferIds: uniqueOfferIds };
  }
} 