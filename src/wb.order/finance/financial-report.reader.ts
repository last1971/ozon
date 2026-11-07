import { Injectable } from '@nestjs/common';
import { WbApiService } from '../../wb.api/wb.api.service';
import { waitRateLimit } from '../../helpers/decorators/rate-limit.decorator';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { WbFinancialContext, WB_FINANCIAL_REPORT_URL } from './financial-report.context';

@Injectable()
export class WbFinancialReportReader {
    constructor(private readonly api: WbApiService) {}
    async page(ctx: WbFinancialContext): Promise<Record<string, unknown>[]> {
        await waitRateLimit('wb:finance:sales-reports', 60000);
        await jobCheckpoint(ctx);
        const result = await this.api.method(
            WB_FINANCIAL_REPORT_URL,
            'post',
            {
                dateFrom: ctx.dateFrom,
                dateTo: ctx.dateTo,
                rrdId: ctx.cursor,
                limit: 100000,
                period: 'weekly',
            },
            true,
        );
        await jobCheckpoint(ctx);
        // Axios возвращает пустую строку для 204. Ошибка или повреждённый JSON — не пустой отчёт.
        if (result === '') return [];
        if (!Array.isArray(result)) {
            const status = result?.error?.status;
            throw new Error(
                `ВБ: финансовый отчёт не прочитан${status ? ` (HTTP ${status})` : ': неверный формат ответа'}`,
            );
        }
        return result;
    }
}
