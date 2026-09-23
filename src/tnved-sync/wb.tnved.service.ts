import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WbCardService } from '../wb.card/wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbCardDto } from '../wb.card/dto/wb.card.dto';
import { goodCode } from '../helpers/product/product.helpers';
import {
    ITnvedUpdateable,
    TnvedBaseItem,
    TnvedCheckItem,
    TnvedCheckResult,
    TnvedUpdateResult,
} from '../interfaces/i.tnved.updateable';

/** Справочник ТН ВЭД предмета: коды, которые ВБ примет в характеристику; null — справочник не отдан. */
type WbTnvedDirectory = Set<string> | null;

/**
 * ВБ как реализация договора ТН ВЭД. Пока только чтение (этап 2), запись — этап 4.
 * Всё вб-шное внутри: ТН ВЭД — характеристика карточки `15000001 «ТНВЭД»`; ВБ принимает не любую
 * строку, а только код из справочника предмета (`/content/v2/directory/tnved?subjectID=`).
 * Карточки, у которых наш код не в справочнике или у предмета нет этой характеристики, — спорные.
 */
@Injectable()
export class WbTnvedService implements ITnvedUpdateable {
    private readonly logger = new Logger(WbTnvedService.name);
    private readonly tnvedCharcId: number;

    constructor(
        private readonly cardService: WbCardService,
        private readonly api: WbApiService,
        config: ConfigService,
    ) {
        // характеристика «ТНВЭД» (не путать с 15004139 «Код ТН ВЭД» — это другое поле)
        this.tnvedCharcId = config.get<number>('WB_TNVED_CHARC_ID', 15000001);
    }

    async checkTnved(base: TnvedBaseItem[]): Promise<TnvedCheckResult> {
        const cardMap = await this.loadCardMap();
        // справочник ТН ВЭД и наличие характеристики — по предмету, резолвим один раз за прогон
        const dirCache = new Map<number, WbTnvedDirectory>();
        const charcCache = new Map<number, boolean>();
        const result: TnvedCheckResult = { items: [], notFound: [] };

        for (const row of base) {
            // все карточки ВБ этого товара: точный goodscode + суффиксные варианты (531557, 531557-10, …)
            const cards = cardMap.get(row.goodscode) ?? [];
            if (cards.length === 0) {
                result.notFound.push(row.goodscode);
                continue;
            }
            for (const card of cards) {
                result.items.push(await this.checkCard(card, row, dirCache, charcCache));
            }
        }
        return result;
    }

    async updateTnved(items: TnvedCheckItem[]): Promise<TnvedUpdateResult[]> {
        // Запись на ВБ перезаписывает карточку целиком — делается на этапе 4 с бэкапом и распознаванием отказов.
        return items.map((item) => ({ offer: item.offer, error: 'запись ТН ВЭД на ВБ не реализована' }));
    }

    /** Решение по одной карточке ВБ (одному vendorCode). */
    private async checkCard(
        card: WbCardDto,
        { goodscode, tnved, markRequired }: TnvedBaseItem,
        dirCache: Map<number, WbTnvedDirectory>,
        charcCache: Map<number, boolean>,
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
        if (!hasCharc) {
            return { ...item, ambiguousReason: `у предмета ${subject} нет характеристики ТНВЭД ${this.tnvedCharcId}` };
        }

        let dir = dirCache.get(card.subjectID);
        if (dir === undefined) {
            dir = await this.loadDirectory(card.subjectID);
            dirCache.set(card.subjectID, dir);
        }
        if (!dir) {
            return { ...item, ambiguousReason: `справочник ТН ВЭД предмета ${subject} не отдан` };
        }
        if (!dir.has(tnved)) {
            return { ...item, ambiguousReason: `ТНВЭД ${tnved} нет в справочнике предмета ${subject}` };
        }

        if (item.current === tnved) {
            return { ...item, ok: true };
        }
        return {
            ...item,
            reason: `ТНВЭД ${item.current ?? '—'}→${tnved}`,
            action: `set ${tnved} в характеристику ${this.tnvedCharcId}`,
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
    private async loadCardMap(): Promise<Map<string, WbCardDto[]>> {
        const map = new Map<string, WbCardDto[]>();
        for (const card of await this.cardService.getAllWbCards()) {
            if (!card.vendorCode) continue;
            const gc = goodCode({ offer_id: card.vendorCode });
            const arr = map.get(gc) ?? [];
            arr.push(card);
            map.set(gc, arr);
        }
        return map;
    }

    /** Есть ли у предмета характеристика ТНВЭД. getCharacteristics отдаёт [] и при сбое — это тоже «нет». */
    private async subjectHasTnvedCharc(subjectId: number): Promise<boolean> {
        const charcs = await this.cardService.getCharacteristics(subjectId);
        return charcs.some((c) => c.charcID === this.tnvedCharcId);
    }

    /** Справочник кодов ТН ВЭД предмета. null — ВБ не ответил (api.method не бросает, возвращает {error}). */
    private async loadDirectory(subjectId: number): Promise<WbTnvedDirectory> {
        const res = await this.api.method(
            'https://content-api.wildberries.ru/content/v2/directory/tnved',
            'get',
            { subjectID: subjectId, locale: 'ru' },
            true,
        );
        if (!Array.isArray(res?.data)) {
            // отказ ВБ должен быть виден в логе, а не тонуть в «спорных»
            this.logger.warn(`[tnved] directory/tnved subjectID=${subjectId}: ${JSON.stringify(res).slice(0, 300)}`);
            return null;
        }
        return new Set(res.data.map((d: any) => String(d.tnved ?? '').trim()).filter(Boolean));
    }
}
