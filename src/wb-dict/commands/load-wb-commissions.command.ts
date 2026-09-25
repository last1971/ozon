import { Injectable } from '@nestjs/common';
import { IJobCommand } from '../../interfaces/i.job.context';
import { IWbDictContext } from '../../interfaces/i.wb.dict.context';
import { WbPriceService } from '../../wb.price/wb.price.service';

/**
 * Предметы и комиссии с ВБ (tariffs/commission) → WB_CATEGORIES.
 * Сама выкачка живёт в WbPriceService.updateWbSaleCoeffs — та же, что у ручки
 * POST /api/price/wb-coefficients; здесь только фаза и отчёт.
 */
@Injectable()
export class LoadWbCommissionsCommand implements IJobCommand<IWbDictContext> {
    readonly phase = 'комиссии';

    constructor(private readonly wbPrice: WbPriceService) {}

    async execute(context: IWbDictContext): Promise<IWbDictContext> {
        context.report.categories = await this.wbPrice.updateWbSaleCoeffs(context.progress);
        return context;
    }
}
