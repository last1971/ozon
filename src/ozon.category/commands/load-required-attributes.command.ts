import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { OzonCategoryService } from '../ozon.category.service';

// Атрибуты, заполняемые программно (не через AI)
const MANUAL_ATTRIBUTE_IDS = new Set([4191, 4383, 23171, 23249, 23518]);

@Injectable()
export class LoadRequiredAttributesCommand implements ICommandAsync<IProductCreateContext> {
    constructor(@Inject(forwardRef(() => OzonCategoryService)) private readonly ozonCategoryService: OzonCategoryService) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const { description_category_id, type_id } = context;
        if (!description_category_id || !type_id) {
            context.logger?.log('Нет description_category_id или type_id, пропускаем загрузку атрибутов');
            context.stopChain = true;
            return context;
        }

        context.logger?.log(`Загрузка атрибутов для desc_cat_id=${description_category_id}, type_id=${type_id}`);

        const result = await this.ozonCategoryService.getCategoryAttributes(description_category_id, type_id);

        context.required_attributes = result.attributes.filter(
            (a) => a.is_required && !MANUAL_ATTRIBUTE_IDS.has(a.id),
        );

        context.logger?.log(
            `Всего атрибутов: ${result.attributes.length}, обязательных для AI: ${context.required_attributes.length}`,
        );
        return context;
    }
}
