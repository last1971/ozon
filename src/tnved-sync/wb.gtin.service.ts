import { Injectable } from '@nestjs/common';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbCardWriter } from '../wb.card/wb.card.writer';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { ICardSyncable, SyncCheckResult, SyncUpdateResult } from '../interfaces/i.card.sync';
import { BarcodeOffer, GtinBaseItem, GtinCheckItem } from '../interfaces/i.gtin.sync';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';
import { barcodeKey, groupByGoodCode } from '../helpers/product/product.helpers';
import { checkGtinOffers } from './gtin.decision';

/**
 * ВБ как реализация режима GTIN. Баркоды карточки — sizes[].skus; у наших карточек один размер,
 * карточка с несколькими размерами — спорная (в какой писать, неясно). Решение — общее (checkGtinOffers).
 * Запись — через общий WbCardWriter по одной карточке (отказ ВБ по пачке иначе лёг бы на всю пачку).
 * ВБ баркоды не удаляет и не меняет, только добавляет.
 */
@Injectable()
export class WbGtinService implements ICardSyncable<GtinBaseItem, GtinCheckItem> {
    constructor(
        private readonly cardService: WbCardService,
        private readonly writer: WbCardWriter,
    ) {}

    async check(base: GtinBaseItem[], progress: JobProgress = emptyProgress()): Promise<SyncCheckResult<GtinCheckItem>> {
        Object.assign(progress, { phase: 'каталог', done: 0, total: undefined });
        const cards = groupByGoodCode(
            await this.cardService.getAllWbCards(100, (loaded) => (progress.done = loaded)),
            (card) => card.vendorCode,
        );
        const byGood = new Map<string, BarcodeOffer[]>();
        for (const b of base) {
            const list = (cards.get(b.goodscode) ?? []).map((card) => this.toBarcodeOffer(card));
            if (list.length) byGood.set(b.goodscode, list);
        }
        return checkGtinOffers(base, byGood, progress);
    }

    async update(items: GtinCheckItem[], progress: JobProgress = emptyProgress()): Promise<SyncUpdateResult[]> {
        Object.assign(progress, { phase: 'запись', done: 0, total: items.length });
        return this.writer.write(
            'gtin',
            items.map((item) => ({ offer: item.offer, edit: (card: WbCardDto) => this.withGtins(card, item.add) })),
            progress,
            1,
        );
    }

    private toBarcodeOffer(card: WbCardDto): BarcodeOffer {
        const sizes = card.sizes ?? [];
        return {
            offer: card.vendorCode,
            name: card.title,
            barcodes: sizes.flatMap((s) => s.skus ?? []),
            ...(sizes.length === 1 ? {} : { ambiguousReason: `у карточки размеров: ${sizes.length} — в какой писать баркод, неясно` }),
        };
    }

    /**
     * GTIN — в КОНЕЦ баркодов единственного размера: первый баркод печатается на этикетках и в сканах,
     * его не сдвигаем. Уже стоящие (в любой длине записи) не дублируем.
     */
    private withGtins(card: WbCardDto, add: string[]): WbCardDto {
        if ((card.sizes ?? []).length !== 1) {
            throw new Error(`у карточки размеров: ${card.sizes?.length ?? 0} — в какой писать баркод, неясно`);
        }
        const size = card.sizes[0];
        const skus = size.skus ?? [];
        const present = new Set(skus.map(barcodeKey));
        size.skus = [...skus, ...add.filter((g) => !present.has(barcodeKey(g)))];
        return card;
    }
}
