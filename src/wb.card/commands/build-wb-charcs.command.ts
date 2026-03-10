import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext, WB_MANUAL_CHARC_NAMES } from '../interfaces/wb-create-card.interface';
import { WbCardCharacteristicDto } from '../dto/wb.card.dto';

@Injectable()
export class BuildWbCharcsCommand implements ICommandAsync<IWbCreateCardContext> {
    private readonly logger = new Logger(BuildWbCharcsCommand.name);

    constructor(private readonly configService: ConfigService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        const charcsMap = new Map(
            (context.charcs || []).map((c) => [c.charcID, c]),
        );

        const result: WbCardCharacteristicDto[] = [];

        // AI характеристики
        for (const ai of context.aiCharacteristics || []) {
            const charc = charcsMap.get(ai.id);
            if (!charc || charc.charcType === 0) continue;

            result.push({ id: ai.id, value: this.formatValue(ai.value, charc.charcType, charc.maxCount) });
        }

        // Программные характеристики
        this.addManualCharcs(context, charcsMap, result);

        context.characteristics = result;
        this.logger.log(`Собрано ${result.length} характеристик (${(context.aiCharacteristics || []).length} AI + программные)`);
        return context;
    }

    private addManualCharcs(
        context: IWbCreateCardContext,
        charcsMap: Map<number, { charcID: number; name: string; charcType: number }>,
        result: WbCardCharacteristicDto[],
    ): void {
        const byName = new Map<string, number>();
        for (const [id, c] of charcsMap) {
            if (WB_MANUAL_CHARC_NAMES.has(c.name)) {
                byName.set(c.name, id);
            }
        }

        // НДС
        const vatCharcId = byName.get('Ставка НДС');
        if (vatCharcId !== undefined) {
            const vatRate = this.configService.get<number>('VAT_RATE');
            if (vatRate !== undefined) {
                result.push({ id: vatCharcId, value: String(vatRate) });
            }
        }

        // Габариты из Ozon attr 4382 "215x115x30" (мм) → WB (см)
        if (context.ozonDimensions) {
            const parts = context.ozonDimensions.split(/[xXхХ×*]/).map((s) => parseFloat(s.trim()));
            if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
                const [depth, width, height] = parts.map((mm) => +(mm / 10).toFixed(1));
                const depthId = byName.get('Глубина предмета');
                const widthId = byName.get('Ширина предмета');
                const heightId = byName.get('Высота предмета');
                if (depthId !== undefined) result.push({ id: depthId, value: depth });
                if (widthId !== undefined) result.push({ id: widthId, value: width });
                if (heightId !== undefined) result.push({ id: heightId, value: height });
            }
        }

        // Вес из Ozon attr 4383
        if (context.ozonWeight) {
            const weightId = byName.get('Вес товара без упаковки (г)');
            if (weightId !== undefined) {
                const w = parseFloat(context.ozonWeight);
                if (!isNaN(w)) result.push({ id: weightId, value: w });
            }
        }

        // Гарантийный срок из Ozon attr 4385
        if (context.ozonWarranty) {
            const warrantyId = byName.get('Гарантийный срок');
            if (warrantyId !== undefined) {
                result.push({ id: warrantyId, value: context.ozonWarranty });
            }
        }
    }

    private formatValue(
        value: number | string | string[],
        charcType: number,
        maxCount: number,
    ): string | string[] | number {
        if (charcType === 4) {
            return typeof value === 'number' ? value : parseFloat(String(value));
        }
        if (Array.isArray(value)) {
            const arr = maxCount > 0 ? value.slice(0, maxCount) : value;
            return arr.map(String);
        }
        return String(value);
    }
}
