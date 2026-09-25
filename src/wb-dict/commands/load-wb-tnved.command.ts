import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IWbDictContext } from '../../interfaces/i.wb.dict.context';
import { WbTnvedService } from '../../tnved-sync/wb.tnved.service';
import { WbCategoriesRepository } from '../wb-categories.repository';

/**
 * Справочник ТН ВЭД по предметам: directory/tnved на каждый предмет → WB_CATEGORIES.TNVED_LIST.
 * Берутся предметы без справочника и с устаревшим (all=true — все). Ответ ВБ есть — пишем и
 * ставим TNVED_AT (пустой тоже пишем, ВБ так ответил); ВБ не ответил — предмет не трогаем,
 * он попадёт в следующий прогон. Темп задаёт калитка WbTnvedService (раз в секунду, 429 → пауза).
 */
@Injectable()
export class LoadWbTnvedCommand implements IJobCommand<IWbDictContext> {
    readonly phase = 'ТН ВЭД';

    constructor(
        private readonly repo: WbCategoriesRepository,
        private readonly wb: WbTnvedService,
    ) {}

    async execute(context: IWbDictContext): Promise<IWbDictContext> {
        const subjects = await this.repo.subjectsToLoad(context.all, context.days);
        const { progress } = context;
        progress.total = subjects.length;
        Object.assign(progress.counters, { saved: 0, empty: 0, failed: 0 });

        for (const subject of subjects) {
            const dir = await this.wb.directory(subject.id);
            if (dir === null) {
                progress.counters.failed++;
                context.logger?.error(`[wb-dict] предмет ${subject.id} «${subject.name}»: справочник не отдан`);
            } else {
                await this.repo.saveTnved(subject.id, dir);
                progress.counters[dir.length ? 'saved' : 'empty']++;
            }
            progress.done++;
        }

        Object.assign(context.report, { subjects: subjects.length, ...progress.counters });
        return context;
    }
}
