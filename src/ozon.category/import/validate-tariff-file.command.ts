import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { ProductService } from '../../product/product.service';
import { OzonApiService } from '../../ozon.api/ozon.api.service';
import { commissionTypesFromTree, validateTariffWorkbook } from '../tariff.xlsx';
import { TariffImportContext } from './tariff-import.context';

@Injectable()
export class ValidateTariffFileCommand implements IJobCommand<TariffImportContext> {
    readonly phase = 'проверка структуры';
    readonly weight = 15;
    constructor(
        private readonly products: ProductService,
        private readonly api: OzonApiService,
    ) {}
    async execute(context: TariffImportContext): Promise<TariffImportContext> {
        await jobCheckpoint(context);
        context.layouts = validateTariffWorkbook(context.workbook, context.kind);
        if (context.kind === 'logistics') {
            context.progress.total = context.layouts.length;
            context.progress.done = context.layouts.length;
            return context;
        }
        context.currentTypes = commissionTypesFromTree(await this.api.method('/v1/description-category/tree', {}));
        context.requiredTypes = await this.catalogTypeIds(context);
        return context;
    }
    private async catalogTypeIds(context: TariffImportContext): Promise<Set<number>> {
        try {
            const offers = await this.products.listAllOfferIds();
            if (!offers.length || new Set(offers).size !== offers.length || offers.some((offer) => !offer))
                throw new Error('Пустой или неоднозначный список товаров');
            context.progress.total = offers.length;
            const types = new Set<number>();
            for (let i = 0; i < offers.length; i += 100) {
                await jobCheckpoint(context);
                const batch = offers.slice(i, i + 100);
                const cards = await this.products.infoList(batch);
                const found = new Set(cards?.map((card) => card.sku));
                if (
                    !cards ||
                    cards.length !== batch.length ||
                    found.size !== batch.length ||
                    batch.some((offer) => !found.has(offer))
                )
                    throw new Error('Получены не все карточки товаров');
                for (const card of cards) {
                    if (!Number.isSafeInteger(card.typeId) || card.typeId <= 0) throw new Error('Нет типа товара');
                    types.add(card.typeId);
                }
                context.progress.done += cards.length;
            }
            context.progress.counters.products = offers.length;
            return types;
        } catch {
            throw new ServiceUnavailableException(
                'Не удалось проверить все товары кабинета. Прежние тарифы сохранены.',
            );
        }
    }
}
