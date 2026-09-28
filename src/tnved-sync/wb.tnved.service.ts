import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { goodCode, groupByGoodCode } from '../helpers/product/product.helpers';
import { WbContentGate } from '../wb.card/wb.content.gate';
import { WbCardWriter } from '../wb.card/wb.card.writer';
import {
    ITnvedUpdateable,
    TnvedBaseItem,
    TnvedCheckItem,
    TnvedCheckResult,
    TnvedMarketOffer,
    TnvedUpdateResult,
} from '../interfaces/i.tnved.updateable';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';
import { TnvedEntry } from '../interfaces/i.tnved.dictionary';

/** Справочник ТН ВЭД предмета: коды, которые ВБ примет в характеристику; null — справочник не отдан. */
type WbTnvedDirectory = Set<string> | null;

/**
 * ВБ как реализация договора ТН ВЭД.
 * Всё вб-шное внутри: ТН ВЭД — характеристика карточки `15000001 «ТНВЭД»`; ВБ принимает не любую
 * строку, а только код из справочника предмета (`/content/v2/directory/tnved?subjectID=`).
 * Галочки маркировки — поля карточки `needKiz` («нужен код маркировки») и `kizMarked` («подтверждаю, что
 * маркировка нанесена», 289-ФЗ); ВБ по коду их не ставит (проверено: 565831 и 474754 — один предмет,
 * один код, разный needKiz), поэтому ставим сами по MARK_REQUIRED, как на Озоне.
 * Карточки, у которых наш код не в справочнике или у предмета нет этой характеристики, — спорные.
 * Запись — через общий WbCardWriter (свежая карточка, бэкап «до», очередь, отложенные отказы).
 */
@Injectable()
export class WbTnvedService implements ITnvedUpdateable {
    private readonly logger = new Logger(WbTnvedService.name);
    private readonly tnvedCharcId: number;

    constructor(
        private readonly cardService: WbCardService,
        private readonly api: WbApiService,
        private readonly gate: WbContentGate,
        private readonly writer: WbCardWriter,
        config: ConfigService,
    ) {
        // характеристика «ТНВЭД» (не путать с 15004139 «Код ТН ВЭД» — это другое поле)
        this.tnvedCharcId = config.get<number>('WB_TNVED_CHARC_ID', 15000001);
    }

    async check(base: TnvedBaseItem[], progress: JobProgress = emptyProgress()): Promise<TnvedCheckResult> {
        Object.assign(progress, { phase: 'каталог', done: 0, total: undefined });
        const cardMap = await this.loadCardMap((loaded) => (progress.done = loaded));
        Object.assign(progress, { phase: 'сверка', done: 0, total: base.length });
        // справочник ТН ВЭД и наличие характеристики — по предмету, резолвим один раз за прогон
        const dirCache = new Map<number, WbTnvedDirectory>();
        const charcCache = new Map<number, boolean | null>();
        const result: TnvedCheckResult = { items: [], notFound: [] };

        for (const row of base) {
            // все карточки ВБ этого товара: точный goodscode + суффиксные варианты (531557, 531557-10, …)
            const cards = cardMap.get(row.goodscode) ?? [];
            if (cards.length === 0) {
                result.notFound.push(row.goodscode);
                progress.done++;
                continue;
            }
            for (const card of cards) {
                result.items.push(await this.checkCard(card, row, dirCache, charcCache));
            }
            progress.done++;
        }
        return result;
    }

    async update(items: TnvedCheckItem[], progress: JobProgress = emptyProgress()): Promise<TnvedUpdateResult[]> {
        Object.assign(progress, { phase: 'запись', done: 0, total: items.length });
        return this.writer.write(
            'tnved',
            items.map((item) => ({
                offer: item.offer,
                edit: (card) => this.withTnved(card, item.base, item.markRequired),
            })),
            progress,
        );
    }

    /**
     * Карточка с нашим ТН ВЭД в характеристике и needKiz/kizMarked по маркируемости. Правится копия
     * (писатель и так даёт свежую копию; своя — чтобы не зависеть от вызывающего).
     */
    private withTnved(card: WbCardDto, tnved: string, markRequired: boolean): WbCardDto {
        const copy: WbCardDto = JSON.parse(JSON.stringify(card));
        const characteristics = copy.characteristics ?? [];
        const charc = characteristics.find((c) => c.id === this.tnvedCharcId);
        if (charc) charc.value = [tnved];
        else characteristics.push({ id: this.tnvedCharcId, value: [tnved] });
        copy.characteristics = characteristics;
        copy.needKiz = markRequired;
        copy.kizMarked = markRequired;
        return copy;
    }

    async listOffers(progress: JobProgress = emptyProgress()): Promise<TnvedMarketOffer[]> {
        Object.assign(progress, { phase: 'каталог', done: 0, total: undefined });
        const cards = await this.cardService.getAllWbCards(100, (loaded) => (progress.done = loaded));
        return cards
            .filter((c) => c.vendorCode)
            .map((c) => ({ offer: c.vendorCode, goodscode: goodCode({ offer_id: c.vendorCode }), name: c.title }));
    }

    /** Решение по одной карточке ВБ (одному vendorCode). */
    private async checkCard(
        card: WbCardDto,
        { goodscode, tnved, markRequired }: TnvedBaseItem,
        dirCache: Map<number, WbTnvedDirectory>,
        charcCache: Map<number, boolean | null>,
    ): Promise<TnvedCheckItem> {
        const item: TnvedCheckItem = {
            offer: card.vendorCode,
            goodscode,
            name: card.title,
            current: this.currentTnved(card),
            base: tnved,
            markRequired,
            ok: false,
        };
        const subject = `${card.subjectName} (${card.subjectID})`;

        let hasCharc = charcCache.get(card.subjectID);
        if (hasCharc === undefined) {
            hasCharc = await this.subjectHasTnvedCharc(card.subjectID);
            charcCache.set(card.subjectID, hasCharc);
        }
        if (hasCharc === null) {
            return { ...item, ambiguousReason: `характеристики предмета ${subject} не отданы` };
        }
        if (!hasCharc) {
            return { ...item, ambiguousReason: `у предмета ${subject} нет характеристики ТНВЭД ${this.tnvedCharcId}` };
        }

        let dir = dirCache.get(card.subjectID);
        if (dir === undefined) {
            const entries = await this.directory(card.subjectID);
            dir = entries ? new Set(entries.map((e) => e.tnved)) : null;
            dirCache.set(card.subjectID, dir);
        }
        if (!dir) {
            return { ...item, ambiguousReason: `справочник ТН ВЭД предмета ${subject} не отдан` };
        }
        if (!dir.has(tnved)) {
            return { ...item, ambiguousReason: `ТНВЭД ${tnved} нет в справочнике предмета ${subject}` };
        }

        // ОК = код совпал И обе галочки маркировки в целевом состоянии (ON для MR=1, OFF для MR=0).
        const needKiz = card.needKiz === true;
        const kizMarked = card.kizMarked === true;
        if (item.current === tnved && needKiz === markRequired && kizMarked === markRequired) {
            return { ...item, ok: true };
        }
        const reasons: string[] = [];
        if (item.current !== tnved) reasons.push(`ТНВЭД ${item.current ?? '—'}→${tnved}`);
        if (needKiz !== markRequired)
            reasons.push(markRequired ? 'включить код маркировки' : 'выключить код маркировки');
        if (kizMarked !== markRequired)
            reasons.push(markRequired ? 'подтвердить маркировку' : 'снять подтверждение маркировки');
        return {
            ...item,
            reason: reasons.join('; '),
            action: `set ${tnved} в характеристику ${this.tnvedCharcId} + needKiz/kizMarked ${markRequired ? 'ON' : 'OFF'}`,
        };
    }

    /** Значение характеристики ТНВЭД карточки: ВБ отдаёт строку, массив строк или число. */
    private currentTnved(card: WbCardDto): string | null {
        const charc = card.characteristics?.find((c) => c.id === this.tnvedCharcId);
        if (!charc) return null;
        const raw = Array.isArray(charc.value) ? charc.value[0] : charc.value;
        const val = String(raw ?? '').trim();
        return val || null;
    }

    /** Карта goodscode -> [карточка…] по всему каталогу ВБ (vendorCode с суффиксом фасовки). */
    private async loadCardMap(onPage?: (loaded: number) => void): Promise<Map<string, WbCardDto[]>> {
        return groupByGoodCode(await this.cardService.getAllWbCards(100, onPage), (card) => card.vendorCode);
    }

    /** Есть ли у предмета характеристика ТНВЭД. null — ВБ не отдал характеристики (в спорные, не «нет»). */
    private async subjectHasTnvedCharc(subjectId: number): Promise<boolean | null> {
        const res = await this.gate.call(`object/charcs/${subjectId}`, () =>
            this.cardService.fetchCharacteristics(subjectId),
        );
        if (res?.error || !Array.isArray(res?.data)) {
            this.logger.warn(`[tnved] object/charcs/${subjectId}: ${JSON.stringify(res).slice(0, 300)}`);
            return null;
        }
        return res.data.some((c: any) => c.charcID === this.tnvedCharcId);
    }

    /**
     * Справочник ТН ВЭД предмета как отдаёт ВБ: код + isKiz («нужен код маркировки»). null — ВБ не ответил.
     * Публичный: тот же справочник выкачивает по всем предметам WbDictModule (карта «код → предметы»),
     * через ту же калитку WbContentGate — лимит у ВБ общий.
     */
    async directory(subjectId: number): Promise<TnvedEntry[] | null> {
        const res = await this.gate.call(`directory/tnved?subjectID=${subjectId}`, () =>
            this.api.method(
                'https://content-api.wildberries.ru/content/v2/directory/tnved',
                'get',
                { subjectID: subjectId, locale: 'ru' },
                true,
            ),
        );
        if (!Array.isArray(res?.data)) {
            // отказ ВБ должен быть виден в логе, а не тонуть в «спорных»
            this.logger.warn(`[tnved] directory/tnved subjectID=${subjectId}: ${JSON.stringify(res).slice(0, 300)}`);
            return null;
        }
        return res.data
            .map((d: any) => ({ tnved: String(d.tnved ?? '').trim(), isKiz: d.isKiz === true }))
            .filter((d: TnvedEntry) => d.tnved);
    }
}
