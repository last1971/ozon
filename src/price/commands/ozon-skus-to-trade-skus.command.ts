import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { goodCode } from '../../helpers';

@Injectable()
export class OzonSkusToTradeSkusCommand implements ICommandAsync<IGoodsProcessingContext> {
    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        if (!context.ozonSkus || context.ozonSkus.length === 0) {
            context.skus = [];
            context.logger?.log('Нет Ozon SKU для конвертации в trade коды');
            return context;
        }

        // Конвертируем Ozon SKU в trade коды, убирая дубликаты
        const tradeCodesSet = new Set<string>();

        context.ozonSkus.forEach(sku => {
            const tradeCode = goodCode({ offer_id: sku });
            tradeCodesSet.add(tradeCode);
        });

        context.skus = Array.from(tradeCodesSet);
        context.logger?.log(`Конвертировано ${context.ozonSkus.length} Ozon SKU в ${context.skus.length} уникальных trade кодов`);

        return context;
    }
}