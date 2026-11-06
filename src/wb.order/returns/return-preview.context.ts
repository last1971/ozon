import { ConfigService } from '@nestjs/config';
import { emptyProgress } from '../../interfaces/i.job.context';
import { lossPeriod } from '../../helpers/price/marketplace.loss.stats';
import { SaveLossContext } from '../../marketplace-loss/loss.commands';

export { LossContext as WbReturnPreviewContext } from '../../marketplace-loss/loss.contracts';

/** Один период и одна проверка кабинета для предварительного отчёта и сохраняемого снимка. */
export function createWbLossContext(config: ConfigService, now = new Date()): SaveLossContext {
    const services = config.get<string[] | string>('SERVICES', []);
    if (!(Array.isArray(services) ? services : services.split(',')).includes('wb'))
        throw new Error('ВБ не подключён к этому кабинету');
    return {
        service: 'WB',
        preliminary: true,
        period: lossPeriod(now),
        calculatedAt: new Date(now.getTime()),
        sales: [],
        writeOffs: [],
        rows: [],
        progress: emptyProgress(),
    };
}
