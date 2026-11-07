import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { isDeepStrictEqual } from 'util';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { WbFinancialContext } from './financial-report.context';
import { financialId, normalizeFinancialRow } from './financial-row';
import { WbFinancialReportReader } from './financial-report.reader';

@Injectable()
export class ValidateWbFinancialReportCommand implements IJobCommand<WbFinancialContext> {
    readonly phase = 'Проверка периода';
    readonly weight = 5;
    async execute(ctx: WbFinancialContext) {
        const date = (v: Date | string) =>
            v instanceof Date
                ? DateTime.fromJSDate(v).setZone('Europe/Moscow')
                : DateTime.fromISO(v, { zone: 'Europe/Moscow' }).setZone('Europe/Moscow');
        const from = date(ctx.from),
            to = date(ctx.to);
        if (!from.isValid || !to.isValid || from.toMillis() > to.toMillis())
            throw new Error('ВБ: неверный период отчёта');
        ctx.cursor = financialId(ctx.cursor, 'начальный rrdId');
        ctx.dateFrom = from.toISO();
        ctx.dateTo = to.toISO();
        return ctx;
    }
}
@Injectable()
export class LoadWbFinancialReportCommand implements IJobCommand<WbFinancialContext> {
    readonly phase = 'Загрузка финансового отчёта';
    readonly weight = 75;
    constructor(private readonly reader: WbFinancialReportReader) {}
    async execute(ctx: WbFinancialContext) {
        const seen = new Map<number, Record<string, unknown>>();
        for (let page = 0; page < 100; page++) {
            await jobCheckpoint(ctx);
            const batch = await this.reader.page(ctx);
            await jobCheckpoint(ctx);
            if (!batch.length) {
                ctx.raw = [...seen.values()];
                ctx.progress.total = ctx.progress.done;
                return ctx;
            }
            let next = ctx.cursor;
            for (let i = 0; i < batch.length; i++) {
                if (i % 500 === 0) await jobCheckpoint(ctx);
                const raw = batch[i];
                const id = financialId(raw?.rrdId, 'rrdId');
                if (!id) throw new Error('ВБ: rrdId должен быть положительным');
                const previous = seen.get(id);
                if (previous && !isDeepStrictEqual(previous, raw))
                    throw new Error(`ВБ: противоречивый дубль строки ${id}`);
                if (!previous) {
                    seen.set(id, raw);
                    ctx.progress.done++;
                }
                next = id;
            }
            if (next <= ctx.cursor) throw new Error('ВБ: курсор финансового отчёта не продвигается');
            ctx.cursor = next;
            ctx.progress.counters.pages = page + 1;
        }
        throw new Error('ВБ: превышен предел страниц, финансовый отчёт неполный');
    }
}
@Injectable()
export class NormalizeWbFinancialReportCommand implements IJobCommand<WbFinancialContext> {
    readonly phase = 'Проверка и преобразование строк';
    readonly weight = 20;
    async execute(ctx: WbFinancialContext) {
        ctx.progress.total = ctx.raw.length;
        const rows = [];
        for (const raw of ctx.raw) {
            if (ctx.progress.done % 500 === 0) await jobCheckpoint(ctx);
            rows.push(normalizeFinancialRow(raw));
            ctx.progress.done++;
        }
        ctx.rows = rows;
        ctx.raw = [];
        return ctx;
    }
}
