import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IDictContext } from '../../interfaces/i.tnved.dictionary';

/**
 * Справочник ТН ВЭД по предметам: на каждый предмет — справочник с маркетплейса → TNVED_LIST.
 * Берутся предметы без справочника и с устаревшим (all=true — все). Ответ есть — пишем и ставим
 * TNVED_AT (пустой тоже пишем, маркетплейс так ответил); ответа нет — предмет не трогаем,
 * он попадёт в следующий прогон. Темп задаёт реализация договора (калитки к API).
 */
@Injectable()
export class LoadTnvedCommand implements IJobCommand<IDictContext> {
    readonly phase = 'ТН ВЭД';

    async execute(context: IDictContext): Promise<IDictContext> {
        const { service, progress } = context;
        const subjects = await service.subjectsToLoad(context.all, context.days);
        progress.total = subjects.length;
        Object.assign(progress.counters, { saved: 0, empty: 0, failed: 0 });

        for (const subject of subjects) {
            const dir = await service.directory(subject);
            if (dir === null) {
                progress.counters.failed++;
                context.logger?.error(`[dict] ${service.market}: предмет ${subject.id} «${subject.name}» — справочник не отдан`);
            } else {
                await service.saveTnved(subject.id, dir);
                progress.counters[dir.length ? 'saved' : 'empty']++;
            }
            progress.done++;
        }

        Object.assign(context.report, { subjects: subjects.length, ...progress.counters });
        return context;
    }
}
