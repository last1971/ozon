import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IVatProcessingContext } from '../../interfaces/i.vat.processing.context';

/**
 * Команда для обновления ставки НДС для списка товаров
 * Универсальна для всех маркетплейсов через IVatUpdateable
 * Извлекает offer_id из mismatches, если они есть
 */
@Injectable()
export class UpdateVatCommand implements ICommandAsync<IVatProcessingContext> {
    async execute(context: IVatProcessingContext): Promise<IVatProcessingContext> {
        // Извлекаем offer_id из mismatches
        const offerIds = context.mismatches && context.mismatches.length > 0
            ? context.mismatches.map(m => m.offer_id)
            : [];

        if (offerIds.length === 0) {
            context.logger?.log('Нет товаров для обновления НДС (несоответствий не найдено)');
            return context;
        }

        if (context.expectedVat === undefined) {
            context.logger?.error('expectedVat не указан в контексте');
            context.stopChain = true;
            return context;
        }

        context.logger?.log(
            `Начинаем обновление НДС для ${offerIds.length} товаров. Новая ставка: ${context.expectedVat}%`,
        );

        try {
            context.updateResult = await context.service.updateVat(offerIds, context.expectedVat);

            context.logger?.log(
                `Обновление НДС завершено для ${offerIds.length} товаров`,
            );
        } catch (error) {
            context.logger?.error(`Ошибка при обновлении НДС: ${error.message}`);
            context.stopChain = true;
        }

        return context;
    }
}
