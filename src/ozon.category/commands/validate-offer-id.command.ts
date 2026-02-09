import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { ProductService } from '../../product/product.service';
import { goodCode, StringToIOfferIdableAdapter } from '../../helpers/product/product.helpers';

@Injectable()
export class ValidateOfferIdCommand implements ICommandAsync<IProductCreateContext> {
    constructor(private readonly productService: ProductService) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const { text, offer_id, images } = context.input;

        // Валидация обязательных полей
        if (!text?.trim()) {
            context.stopChain = true;
            context.error_message = 'Не заполнен текст товара';
            return context;
        }
        if (!offer_id?.trim()) {
            context.stopChain = true;
            context.error_message = 'Не заполнен артикул (offer_id)';
            return context;
        }
        if (!images?.length || !images.some(img => img?.trim())) {
            context.stopChain = true;
            context.error_message = 'Не добавлены картинки';
            return context;
        }

        // Проверка дубликата offer_id
        context.logger?.log(`Проверка артикула: "${offer_id}"`);
        const inputBase = goodCode(new StringToIOfferIdableAdapter(offer_id));
        const skuList = this.productService.skuList;

        if (!skuList.length) {
            context.logger?.log('skuList пуст — пропускаем проверку дубликатов');
            return context;
        }

        for (const sku of skuList) {
            const skuBase = goodCode(new StringToIOfferIdableAdapter(sku));
            if (skuBase === inputBase) {
                context.stopChain = true;
                context.error_message = `Товар с артикулом "${offer_id}" уже существует на Ozon (совпадение с ${sku})`;
                context.logger?.log(context.error_message);
                return context;
            }
        }

        context.logger?.log(`Артикул "${offer_id}" свободен`);
        return context;
    }
}
