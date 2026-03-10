import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IWbCreateCardContext, WbCategoryMode } from '../interfaces/wb-create-card.interface';
import { OzonCategoryService } from '../../ozon.category/ozon.category.service';

@Injectable()
export class ResolveWbCategoryCommand implements ICommandAsync<IWbCreateCardContext> {
    constructor(private readonly ozonCategoryService: OzonCategoryService) {}

    async execute(context: IWbCreateCardContext): Promise<IWbCreateCardContext> {
        if (context.categoryMode === WbCategoryMode.MANUAL) {
            if (!context.subjectId) {
                context.stopChain = true;
                context.error_message = 'categoryMode=manual, но subjectId не указан';
            }
            return context;
        }

        let results: { subjectID: number }[] = [];

        if (context.categoryMode === WbCategoryMode.BY_OZON_TYPE) {
            if (!context.typeId) {
                context.stopChain = true;
                context.error_message = 'typeId не найден в карточке Ozon';
                return context;
            }
            results = await this.ozonCategoryService.searchWbByOzonType(context.typeId);
        } else if (context.categoryMode === WbCategoryMode.BY_NAME) {
            results = await this.ozonCategoryService.searchWbCategory(context.ozonName || context.productName);
        }

        if (!results.length) {
            context.stopChain = true;
            context.error_message = 'WB категория не найдена';
            return context;
        }

        context.subjectId = results[0].subjectID;
        return context;
    }
}
