import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IVatProcessingContext } from '../../interfaces/i.vat.processing.context';

/**
 * Команда для проверки несоответствия НДС по всем товарам
 * Универсальна для всех маркетплейсов через IVatUpdateable
 */
@Injectable()
export class CheckVatCommand implements ICommandAsync<IVatProcessingContext> {
    async execute(context: IVatProcessingContext): Promise<IVatProcessingContext> {
        if (context.expectedVat === undefined) {
            context.logger?.error('expectedVat не указан в контексте');
            context.stopChain = true;
            return context;
        }

        context.logger?.log(
            `Начинаем проверку НДС. Ожидаемая ставка: ${context.expectedVat}%, лимит: ${context.limit || 1000}`,
        );

        try {
            context.mismatches = await context.service.checkVatForAll(context.expectedVat, context.limit);

            context.logger?.log(
                `Проверка завершена. Найдено несоответствий: ${context.mismatches.length}`,
            );

            if (context.mismatches.length > 0) {
                context.logger?.log(
                    `Примеры несоответствий (первые 5): ${JSON.stringify(context.mismatches.slice(0, 5), null, 2)}`,
                );
            }
        } catch (error) {
            context.logger?.error(`Ошибка при проверке НДС: ${error.message}`);
            context.stopChain = true;
        }

        return context;
    }
}
