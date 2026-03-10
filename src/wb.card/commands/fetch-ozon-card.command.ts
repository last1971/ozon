import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext } from '../interfaces/wb-create-card.interface';
import { ProductService } from '../../product/product.service';

@Injectable()
export class FetchOzonCardCommand implements ICommandAsync<IWbCreateCardContext> {
    constructor(private readonly productService: ProductService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        const card = await this.productService.getProductAttributes(context.offerId);
        if (!card) {
            context.stopChain = true;
            context.error_message = `Карточка Ozon не найдена: ${context.offerId}`;
            return context;
        }

        context.ozonCard = card;
        context.ozonName = card.name;
        context.productName = card.name;
        context.barcodes = card.barcodes || [];
        context.ozonHeight = card.height;
        context.ozonDepth = card.depth;
        context.ozonWidth = card.width;
        context.ozonWeightGrams = card.weight;
        context.typeId = card.type_id;
        context.descriptionCategoryId = card.description_category_id;

        // Извлекаем атрибуты
        const attrs = card.attributes || [];
        const getAttrValue = (id: number): string | undefined => {
            const attr = attrs.find((a: any) => a.id === id);
            return attr?.values?.[0]?.value;
        };

        context.brand = getAttrValue(85) || '';
        context.description = getAttrValue(4191) || '';
        context.ozonDimensions = getAttrValue(4382);
        context.ozonWeight = getAttrValue(4383);
        context.ozonWarranty = getAttrValue(4385);

        return context;
    }
}
