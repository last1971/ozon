import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IProductCreateContext } from '../interfaces/product-create.context';
import { OzonCategoryService } from '../ozon.category.service';
import { FIREBIRD } from '../../firebird/firebird.module';
import { FirebirdPool } from 'ts-firebird';

@Injectable()
export class FindCategoryCommand implements ICommandAsync<IProductCreateContext> {
    constructor(
        @Inject(forwardRef(() => OzonCategoryService)) private readonly ozonCategoryService: OzonCategoryService,
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
    ) {}

    async execute(context: IProductCreateContext): Promise<IProductCreateContext> {
        const name = context.generated_name || context.input.text;
        context.logger?.log(`Поиск категории для: "${name}"`);

        const results = await this.ozonCategoryService.searchSimilar(name, 5);
        if (!results.length) {
            context.logger?.log('Категории не найдены');
            context.stopChain = true;
            return context;
        }

        // Выбираем категорию с наименьшей FBS комиссией
        let best = results[0];
        for (let i = 1; i < results.length; i++) {
            if (
                results[i].fbsCommission !== null &&
                best.fbsCommission !== null &&
                results[i].fbsCommission < best.fbsCommission
            ) {
                best = results[i];
            }
        }

        // Получаем description_category_id из БД
        const t = await this.pool.getTransaction();
        try {
            const [row] = await t.query(
                'SELECT CATEGORY_ID FROM OZON_TYPES WHERE TYPE_ID = ?',
                [best.typeId],
                false,
            );
            await t.commit(true);

            context.description_category_id = row?.CATEGORY_ID;
            context.type_id = best.typeId;
            context.fbs_commission = best.fbsCommission;
            context.category_path = best.categoryPath;

            context.logger?.log(
                `Категория: ${best.categoryPath} (type_id=${best.typeId}, desc_cat_id=${row?.CATEGORY_ID}, commission=${best.fbsCommission})`,
            );
        } catch (error) {
            await t.rollback(true);
            throw error;
        }

        return context;
    }
}
