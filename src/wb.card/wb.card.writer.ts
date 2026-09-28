import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { WbCardService } from './wb.card.service';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbContentGate } from './wb.content.gate';
import { WbCardDto } from './dto/wb.card.dto';
import { emptyProgress, JobProgress } from '../interfaces/i.job.context';
import { SyncUpdateResult } from '../interfaces/i.card.sync';

/** Правка одной карточки: артикул + что поменять в свежей копии карточки (вернуть её же). */
export interface WbCardEdit {
    offer: string;
    edit: (card: WbCardDto) => WbCardDto;
}

/**
 * Единственный путь записи карточек ВБ (ТН ВЭД, GTIN, НДС). cards/update перезаписывает карточку целиком —
 * чего не отправили, то пропадёт, поэтому:
 *   - карточка читается с ВБ прямо перед записью (не из кэша), правка — поверх свежей копии;
 *   - записи идут строго по одной очереди: две задачи не затрут правки друг друга;
 *   - карточки «до» ложатся в файл backup/wb-cards/<label>-<время>.json — откатить иначе нечем;
 *   - отказ пачки ложится на её карточки; отказы, которые ВБ кладёт в отложенный список, читаются после записи;
 *   - записанная карточка кладётся в кэш WbCardService, чтобы следующая правка не ушла со старыми полями.
 */
@Injectable()
export class WbCardWriter {
    private readonly logger = new Logger(WbCardWriter.name);
    private readonly backupDir: string;
    private readonly errorsDelayMs: number;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly cardService: WbCardService,
        private readonly api: WbApiService,
        private readonly gate: WbContentGate,
        config: ConfigService,
    ) {
        // куда складывать карточки «до» перед записью (в .gitignore)
        this.backupDir = config.get<string>('WB_CARD_BACKUP_DIR', 'backup/wb-cards');
        // сколько ждать после cards/update, прежде чем читать отложенные ошибки ВБ
        this.errorsDelayMs = config.get<number>('WB_CARD_ERRORS_DELAY_MS', 5000);
    }

    /**
     * Записать правки. chunkSize — сколько карточек в одном cards/update: отказ ВБ по пачке ложится на все её
     * карточки, поэтому где важна точность — по одной; по умолчанию всё одной пачкой.
     * Итог по каждой карточке: { offer } или { offer, error }. progress.done двигается по отправленным.
     */
    write(
        label: string,
        edits: WbCardEdit[],
        progress: JobProgress = emptyProgress(),
        chunkSize = Number.POSITIVE_INFINITY,
    ): Promise<SyncUpdateResult[]> {
        const run = this.queue.then(() => this.writeNow(label, edits, progress, chunkSize));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async writeNow(
        label: string,
        edits: WbCardEdit[],
        progress: JobProgress,
        chunkSize: number,
    ): Promise<SyncUpdateResult[]> {
        const results: SyncUpdateResult[] = [];
        const before: WbCardDto[] = [];
        const after: WbCardDto[] = [];

        for (const { offer, edit } of edits) {
            let card: WbCardDto | null;
            try {
                card = await this.cardService.fetchWbCard(offer);
            } catch (e) {
                results.push({ offer, error: `карточка не прочитана с ВБ: ${e?.message ?? e}` });
                continue;
            }
            if (!card) {
                results.push({ offer, error: 'карточка не найдена на ВБ' });
                continue;
            }
            let edited: WbCardDto;
            try {
                edited = edit(JSON.parse(JSON.stringify(card)));
            } catch (e) {
                results.push({ offer, error: `правка не применена: ${e?.message ?? e}` });
                continue;
            }
            before.push(card);
            after.push(edited);
        }
        if (!after.length) return results;

        const backup = await this.backupCards(label, before);
        this.logger.log(`[${label}] ВБ: карточки «до» (${before.length}) сохранены в ${backup}, пишем ${after.length}`);

        const writtenAt = Date.now();
        const size = chunkSize > 0 ? chunkSize : after.length;
        const rejected = new Map<string, string>();
        let accepted = false;
        for (let i = 0; i < after.length; i += size) {
            const chunk = after.slice(i, i + size);
            const errors = this.updateErrors(await this.cardService.updateCards(chunk));
            if (errors.length) {
                this.logger.warn(`[${label}] ВБ cards/update отказ: ${errors.join('; ')}`);
                for (const c of chunk) rejected.set(c.vendorCode, errors.join('; '));
            } else {
                accepted = true;
            }
            progress.done = Math.min(i + size, after.length);
        }

        // Пачку ВБ принимает молча, а отказы по карточкам (бренд не в справочнике и т.п.) кладёт в отложенный список.
        const deferred = accepted ? await this.loadDeferredErrors(label, writtenAt) : new Map<string, string>();
        for (const card of after) {
            const err = rejected.get(card.vendorCode) ?? deferred.get(card.vendorCode);
            if (err) {
                results.push({ offer: card.vendorCode, error: err });
            } else {
                results.push({ offer: card.vendorCode });
                this.cardService.rememberCard(card);
            }
        }
        return results;
    }

    /**
     * Отложенные ошибки ВБ по карточкам: POST /content/v2/cards/error/list (GET даёт 405).
     * Берём только пачки не старше нашей записи — старые отказы по тем же артикулам не считаются.
     * Ключ — vendorCode, значение — текст ВБ («Бренд «X» не найден»).
     */
    private async loadDeferredErrors(label: string, writtenAt: number): Promise<Map<string, string>> {
        await new Promise((r) => setTimeout(r, this.errorsDelayMs));
        const res = await this.gate.call('cards/error/list', () =>
            this.api.method('https://content-api.wildberries.ru/content/v2/cards/error/list', 'post', {}, true),
        );
        const map = new Map<string, string>();
        const batches: any[] = res?.data?.items ?? [];
        if (res?.error || !Array.isArray(batches)) {
            this.logger.warn(`[${label}] cards/error/list не отдан: ${JSON.stringify(res).slice(0, 300)}`);
            return map;
        }
        for (const b of batches) {
            const at = Date.parse(b.updatedAt ?? '');
            if (!isNaN(at) && at < writtenAt - 60_000) continue;
            for (const [vendorCode, texts] of Object.entries(b.errors ?? {})) {
                map.set(vendorCode, `ВБ отверг: ${(texts as string[]).join('; ')}`);
            }
        }
        if (map.size) this.logger.warn(`[${label}] ВБ отложенные отказы: ${map.size} карточек`);
        return map;
    }

    /** Карточки «до» — в файл backup/wb-cards/<label>-<время>.json. Путь возвращаем для лога. */
    private async backupCards(label: string, cards: WbCardDto[]): Promise<string> {
        await mkdir(this.backupDir, { recursive: true });
        const file = join(this.backupDir, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
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
}
