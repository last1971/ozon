import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { goodCode } from '../helpers/product/product.helpers';
import { RateLimit, setRateLimitBlocked } from '../helpers/decorators/rate-limit.decorator';
import {
    ITnvedUpdateable,
    TnvedBaseItem,
    TnvedCheckItem,
    TnvedCheckResult,
    TnvedMarketOffer,
    TnvedUpdateResult,
} from '../interfaces/i.tnved.updateable';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';
import { WbTnvedEntry } from '../interfaces/i.wb.dict.context';

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
 * Запись — read-modify-write целой карточки (как updateVat): перед отправкой карточки «до» ложатся в файл,
 * потому что cards/update перезаписывает карточку целиком и откатить её иначе нечем.
 */
@Injectable()
export class WbTnvedService implements ITnvedUpdateable {
    private readonly logger = new Logger(WbTnvedService.name);
    private readonly tnvedCharcId: number;
    private readonly backupDir: string;
    private readonly errorsDelayMs: number;

    constructor(
        private readonly cardService: WbCardService,
        private readonly api: WbApiService,
        config: ConfigService,
    ) {
        // характеристика «ТНВЭД» (не путать с 15004139 «Код ТН ВЭД» — это другое поле)
        this.tnvedCharcId = config.get<number>('WB_TNVED_CHARC_ID', 15000001);
        // куда складывать карточки «до» перед записью (в .gitignore)
        this.backupDir = config.get<string>('WB_CARD_BACKUP_DIR', 'backup/wb-cards');
        // сколько ждать после cards/update, прежде чем читать отложенные ошибки ВБ
        this.errorsDelayMs = config.get<number>('WB_CARD_ERRORS_DELAY_MS', 5000);
    }

    async checkTnved(base: TnvedBaseItem[], progress: JobProgress = emptyProgress()): Promise<TnvedCheckResult> {
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

    async updateTnved(items: TnvedCheckItem[], progress: JobProgress = emptyProgress()): Promise<TnvedUpdateResult[]> {
        Object.assign(progress, { phase: 'запись', done: 0, total: items.length });
        const results: TnvedUpdateResult[] = [];
        const before: WbCardDto[] = [];
        const after: WbCardDto[] = [];
        const sent: TnvedCheckItem[] = [];

        for (const item of items) {
            const card = await this.cardService.getWbCardAsync(item.offer);
            if (!card) {
                results.push({ offer: item.offer, error: 'карточка не найдена на ВБ' });
                continue;
            }
            before.push(card);
            after.push(this.withTnved(card, item.base, item.markRequired));
            sent.push(item);
        }
        if (!after.length) return results;

        const backup = await this.backupCards(before);
        this.logger.log(`[tnved] ВБ: карточки «до» (${before.length}) сохранены в ${backup}, пишем ${after.length}`);

        const writtenAt = Date.now();
        const errors = this.updateErrors(await this.cardService.updateCards(after));
        if (errors.length) this.logger.warn(`[tnved] ВБ cards/update отказ: ${errors.join('; ')}`);
        progress.done = sent.length;

        // Пачку ВБ принимает молча, а отказы по карточкам (бренд не в справочнике и т.п.) кладёт в отложенный список.
        const deferred = errors.length ? new Map<string, string>() : await this.loadDeferredErrors(writtenAt);
        for (const item of sent) {
            const err = errors.length ? errors.join('; ') : deferred.get(item.offer);
            results.push(err ? { offer: item.offer, error: err } : { offer: item.offer });
        }
        return results;
    }

    /**
     * Отложенные ошибки ВБ по карточкам: POST /content/v2/cards/error/list (GET даёт 405).
     * Берём только пачки не старше нашей записи — старые отказы по тем же артикулам не считаются.
     * Ключ — vendorCode, значение — текст ВБ («Бренд «X» не найден»).
     */
    private async loadDeferredErrors(writtenAt: number): Promise<Map<string, string>> {
        await new Promise((r) => setTimeout(r, this.errorsDelayMs));
        const res = await this.content('cards/error/list', () =>
            this.api.method('https://content-api.wildberries.ru/content/v2/cards/error/list', 'post', {}, true),
        );
        const map = new Map<string, string>();
        const batches: any[] = res?.data?.items ?? [];
        if (res?.error || !Array.isArray(batches)) {
            this.logger.warn(`[tnved] cards/error/list не отдан: ${JSON.stringify(res).slice(0, 300)}`);
            return map;
        }
        for (const b of batches) {
            const at = Date.parse(b.updatedAt ?? '');
            if (!isNaN(at) && at < writtenAt - 60_000) continue;
            for (const [vendorCode, texts] of Object.entries(b.errors ?? {})) {
                map.set(vendorCode, `ВБ отверг: ${(texts as string[]).join('; ')}`);
            }
        }
        if (map.size) this.logger.warn(`[tnved] ВБ отложенные отказы: ${map.size} карточек`);
        return map;
    }

    /**
     * Копия карточки с нашим ТН ВЭД в характеристике и needKiz/kizMarked по маркируемости. Оригинал не трогаем: он лежит в кэше WbCardService.
     * Копия сырая (JSON), чтобы уехали все поля, что отдал список, а не только известные DTO —
     * cards/update перезаписывает карточку целиком, чего не отправили — пропадёт.
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

    /** Карточки «до» — в файл backup/wb-cards/tnved-<время>.json. Путь возвращаем для лога. */
    private async backupCards(cards: WbCardDto[]): Promise<string> {
        await mkdir(this.backupDir, { recursive: true });
        const file = join(this.backupDir, `tnved-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        await writeFile(file, JSON.stringify(cards, null, 2), 'utf8');
        return file;
    }

    /**
     * Отказы cards/update. api.method не бросает: HTTP-ошибка приходит как {status:'NotOk', error},
     * а «принято, но не всё» — как {error:true, errorText, additionalErrors}. Молчаливый успех = [].
     */
    private updateErrors(results: any): string[] {
        const list: any[] = Array.isArray(results) ? results : [results];
        const errors: string[] = [];
        for (const r of list) {
            if (!r) continue;
            if (r.status === 'NotOk') {
                errors.push(`HTTP ${r.error?.status ?? '?'}: ${r.error?.message ?? r.error?.service_message ?? '?'}`);
            } else if (r.error === true || r.errorText) {
                const extra = r.additionalErrors ? ` ${JSON.stringify(r.additionalErrors)}` : '';
                errors.push(`${r.errorText || 'error'}${extra}`);
            }
        }
        return errors;
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
        if (needKiz !== markRequired) reasons.push(markRequired ? 'включить код маркировки' : 'выключить код маркировки');
        if (kizMarked !== markRequired) reasons.push(markRequired ? 'подтвердить маркировку' : 'снять подтверждение маркировки');
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
        const map = new Map<string, WbCardDto[]>();
        for (const card of await this.cardService.getAllWbCards(100, onPage)) {
            if (!card.vendorCode) continue;
            const gc = goodCode({ offer_id: card.vendorCode });
            const arr = map.get(gc) ?? [];
            arr.push(card);
            map.set(gc, arr);
        }
        return map;
    }

    /**
     * Все обращения к контентному API ВБ — через одну калитку: не чаще раза в секунду, при 429 — пауза
     * retryAfterMs и повтор (до трёх раз). Лимит у ВБ общий на все контентные методы, и после выкачки
     * каталога он исчерпан, поэтому без паузы и справочники, и характеристики предмета отвечают 429.
     * api.method не бросает — 429 приходит как {error:{status:429, retryAfterMs}}.
     */
    @RateLimit(1000)
    private async content(label: string, call: () => Promise<any>, attempt = 0): Promise<any> {
        const res = await call();
        if (res?.error?.status === 429 && attempt < 3) {
            const retryAfterMs = res.error.retryAfterMs || 60000;
            this.logger.warn(`[tnved] ВБ 429 на ${label}, ждём ${retryAfterMs} мс и повторяем`);
            setRateLimitBlocked(WbTnvedService.name, 'content', Date.now() + retryAfterMs);
            return this.content(label, call, attempt + 1);
        }
        return res;
    }

    /** Есть ли у предмета характеристика ТНВЭД. null — ВБ не отдал характеристики (в спорные, не «нет»). */
    private async subjectHasTnvedCharc(subjectId: number): Promise<boolean | null> {
        const res = await this.content(`object/charcs/${subjectId}`, () => this.cardService.fetchCharacteristics(subjectId));
        if (res?.error || !Array.isArray(res?.data)) {
            this.logger.warn(`[tnved] object/charcs/${subjectId}: ${JSON.stringify(res).slice(0, 300)}`);
            return null;
        }
        return res.data.some((c: any) => c.charcID === this.tnvedCharcId);
    }

    /**
     * Справочник ТН ВЭД предмета как отдаёт ВБ: код + isKiz («нужен код маркировки»). null — ВБ не ответил.
     * Публичный: тот же справочник выкачивает по всем предметам WbDictModule (карта «код → предметы»),
     * через ту же калитку content() — лимит у ВБ общий.
     */
    async directory(subjectId: number): Promise<WbTnvedEntry[] | null> {
        const res = await this.content(`directory/tnved?subjectID=${subjectId}`, () =>
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
            .filter((d: WbTnvedEntry) => d.tnved);
    }
}
