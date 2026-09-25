import { Inject, Injectable } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { GoodServiceEnum } from '../good/good.service.enum';
import { JobProgress } from '../interfaces/i.job.context';
import { DictStats, DictSubject, DictSubjectTnved, ITnvedDictionary, TnvedEntry } from '../interfaces/i.tnved.dictionary';
import { WbTnvedService } from '../tnved-sync/wb.tnved.service';
import { WbPriceService } from '../wb.price/wb.price.service';
import { DictTableRepository } from './dict-table.repository';

/**
 * ВБ как реализация договора справочника. Предметы с комиссиями — tariffs/commission
 * (тот же WbPriceService.updateWbSaleCoeffs, что у ручки POST /api/price/wb-coefficients),
 * справочник ТН ВЭД предмета — directory/tnved через общую калитку WbTnvedService
 * (раз в секунду, 429 → пауза: лимит контентного API у ВБ общий). Таблица — WB_CATEGORIES.
 */
@Injectable()
export class WbDictService implements ITnvedDictionary {
    readonly market = GoodServiceEnum.WB;
    private readonly repo: DictTableRepository;

    constructor(
        @Inject(FIREBIRD) pool: FirebirdPool,
        private readonly wbPrice: WbPriceService,
        private readonly wbTnved: WbTnvedService,
    ) {
        this.repo = new DictTableRepository(pool, this.market, {
            table: 'WB_CATEGORIES',
            id: 'ID',
            name: 'NAME',
            parent: 'PARENT_NAME',
            commission: 'COMMISSION',
        });
    }

    loadCategories(progress: JobProgress): Promise<number> {
        return this.wbPrice.updateWbSaleCoeffs(progress);
    }

    subjectsToLoad(all: boolean, days: number): Promise<DictSubject[]> {
        return this.repo.subjectsToLoad(all, days);
    }

    directory(subject: DictSubject): Promise<TnvedEntry[] | null> {
        return this.wbTnved.directory(subject.id);
    }

    saveTnved(id: number, entries: TnvedEntry[]): Promise<void> {
        return this.repo.saveTnved(id, entries);
    }

    listWithTnved(): Promise<DictSubjectTnved[]> {
        return this.repo.listWithTnved();
    }

    stats(days: number): Promise<DictStats> {
        return this.repo.stats(days);
    }
}
