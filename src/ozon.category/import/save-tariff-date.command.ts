import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { TariffImportContext } from './tariff-import.context';

@Injectable()
export class SaveTariffDateCommand implements IJobCommand<TariffImportContext> {
    readonly phase = 'фиксация даты загрузки';
    readonly weight = 5;
    async execute(context: TariffImportContext): Promise<TariffImportContext> {
        await jobCheckpoint(context);
        context.progress.total = 1;
        const t = context.transaction;
        const result = context.result;
        if (!t || !result) throw new Error('Нет подготовленных тарифов для фиксации');
        const uploadedAt = new Date();
        await t.execute(
            'UPDATE OZON_TARIFF_SOURCE SET FILE_NAME = ?, FILE_DATE = ?, UPLOADED_AT = ?, FILE_HASH = ?, ROWS_COUNT = ?, MATCHED_COUNT = ?, MISSING_COUNT = ? WHERE KIND = ?',
            [
                result.filename,
                result.fileDate,
                uploadedAt,
                result.hash,
                result.rows,
                result.updated ?? null,
                result.retiredCount ?? null,
                context.kind,
            ],
            false,
        );
        await jobCheckpoint(context);
        // Строки и дата публикуются одновременно. Во время COMMIT отмена уже не обещает откат.
        context.committing = true;
        await t.commit(true);
        context.transaction = undefined;
        result.uploadedAt = uploadedAt;
        context.progress.done = 1;
        return context;
    }
}
