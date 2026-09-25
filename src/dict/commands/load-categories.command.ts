import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IDictContext } from '../../interfaces/i.tnved.dictionary';

/** Предметы и комиссии с маркетплейса → его таблица. Как — знает реализация договора. */
@Injectable()
export class LoadCategoriesCommand implements IJobCommand<IDictContext> {
    readonly phase = 'категории';

    async execute(context: IDictContext): Promise<IDictContext> {
        context.report.categories = await context.service.loadCategories(context.progress);
        return context;
    }
}
