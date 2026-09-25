import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../firebird/firebird.module';
import { GoodServiceEnum } from '../good/good.service.enum';
import { JobProgress } from '../interfaces/i.job.context';
import { DictStats, DictSubject, DictSubjectTnved, ITnvedDictionary, TnvedEntry } from '../interfaces/i.tnved.dictionary';
import { OzonCategoryService } from '../ozon.category/ozon.category.service';
import { ProductService } from '../product/product.service';
import { MARK_LABEL } from '../tnved-sync/ozon.tnved.service';
import { RateLimit } from '../helpers/decorators/rate-limit.decorator';
import { DictTableRepository } from './dict-table.repository';

/**
 * Значения словаря ТН ВЭД Озона → записи справочника. Значение — «8504409100 - МАРКИРОВКА РФ - Преобразователи»
 * либо «8504409100 - Преобразователи»: код в начале, маркируемость по метке. Один код — одна запись:
 * если хоть один вариант кода с меткой, код маркируемый. Чистая, ради теста.
 */
export function parseOzonTnvedValues(values: { value?: string }[]): TnvedEntry[] {
    const byCode = new Map<string, boolean>();
    for (const v of values) {
        const text = String(v?.value ?? '').trim();
        const code = text.match(/^\d{4,10}/)?.[0];
        if (!code) continue;
        byCode.set(code, (byCode.get(code) ?? false) || text.includes(MARK_LABEL));
    }
    return [...byCode].map(([tnved, isKiz]) => ({ tnved, isKiz }));
}

/**
 * Озон как реализация договора справочника. «Предмет» здесь — тип товара (OZON_TYPES),
 * категории и типы качает OzonCategoryService.importCategories (дерево description-category/tree),
 * справочник ТН ВЭД типа — словарь атрибута ТН ВЭД (attribute/values по категории + типу),
 * без кэша ProductService: 9000 словарей в памяти процесса не нужны.
 */
@Injectable()
export class OzonDictService implements ITnvedDictionary {
    readonly market = GoodServiceEnum.OZON;
    private readonly logger = new Logger(OzonDictService.name);
    private readonly repo: DictTableRepository;
    private readonly tnvedAttrId: number;

    constructor(
        @Inject(FIREBIRD) pool: FirebirdPool,
        private readonly categories: OzonCategoryService,
        private readonly products: ProductService,
        config: ConfigService,
    ) {
        // тот же атрибут, что у сверки ТН ВЭД (OzonTnvedService)
        this.tnvedAttrId = config.get<number>('OZON_TNVED_ATTR_ID', 22232);
        this.repo = new DictTableRepository(pool, this.market, {
            table: 'OZON_TYPES',
            id: 'TYPE_ID',
            name: 'TYPE_NAME',
            parent: 'CATEGORY_PATH',
            category: 'CATEGORY_ID',
        });
    }

    /** Дерево пишется одной транзакцией целиком, по ходу счётчика нет — прогресс без total. */
    async loadCategories(progress: JobProgress): Promise<number> {
        const { types } = await this.categories.importCategories();
        progress.done = types;
        return types;
    }

    subjectsToLoad(all: boolean, days: number): Promise<DictSubject[]> {
        return this.repo.subjectsToLoad(all, days);
    }

    /** Ozon отдаёт словарь страницами по 5000; лимит Seller API щадящий, но подряд 9000 типов — с паузой. */
    @RateLimit(300)
    async directory(subject: DictSubject): Promise<TnvedEntry[] | null> {
        if (!subject.categoryId) {
            this.logger.warn(`[dict] тип ${subject.id} «${subject.name}» без категории — словарь не спросить`);
            return null;
        }
        try {
            const values = await this.products.fetchCategoryAttributeValues(this.tnvedAttrId, subject.categoryId, subject.id);
            return parseOzonTnvedValues(values);
        } catch (e) {
            this.logger.warn(`[dict] attribute/values тип ${subject.id}: ${e?.message ?? e}`);
            return null;
        }
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
