import { ProductService } from '../product/product.service';
import { OzonApiService } from '../ozon.api/ozon.api.service';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import type { LogisticsRow } from './tariff.xlsx';
import { FIREBIRD } from '../firebird/firebird.module';
import { NotifierService } from '../notify/notifier.service';
import { NotifyTopic } from '../notify/notify.types';
import {
    commissionTypesFromTree,
    matchCommissions,
    parseCommissions,
    parseLogistics,
    sourceMetadata,
} from './tariff.xlsx';

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlNumber = (n: number | null) => (n === null ? 'NULL' : String(n));
type Kind = 'commissions' | 'logistics';

@Injectable()
export class OzonTariffService {
    private readonly logisticsCache = new Map<string, LogisticsRow[]>();
    private readonly logger = new Logger(OzonTariffService.name);
    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly notifier: NotifierService,
        private readonly config: ConfigService,
        private readonly ozonApi: OzonApiService,
        private readonly products: ProductService,
    ) {}

    private async transaction<T>(
        run: (t: Awaited<ReturnType<FirebirdPool['getTransaction']>>) => Promise<T>,
    ): Promise<T> {
        if (!this.pool) throw new ServiceUnavailableException('Нет подключения к базе.');
        const t = await this.pool.getTransaction();
        try {
            const result = await run(t);
            await t.commit(true);
            return result;
        } catch (e) {
            await t.rollback(true).catch(() => undefined);
            // До отдельного разрешения SQL-патч не применяется. Старые функции магазина продолжают работать.
            if (/table unknown|relation.*not.*defined/i.test(e.message || ''))
                throw new ServiceUnavailableException(
                    'Таблицы тарифов не созданы. Нужен согласованный SQL-патч этапа 2.',
                );
            throw e;
        }
    }

    private async blocks(t: Awaited<ReturnType<FirebirdPool['getTransaction']>>, statements: string[]) {
        for (let i = 0; i < statements.length; i += 20) {
            await t.execute(`EXECUTE BLOCK AS BEGIN\n${statements.slice(i, i + 20).join('\n')}\nEND`, [], false);
        }
    }

    private async lock(t: Awaited<ReturnType<FirebirdPool['getTransaction']>>, kind: Kind) {
        const rows = await t.query('SELECT KIND FROM OZON_TARIFF_SOURCE WHERE KIND = ?', [kind], false);
        if (!rows.length)
            throw new ServiceUnavailableException('Нет служебной записи тарифов. Проверьте SQL-патч этапа 2.');
        // Блокируем одну строку на время всей замены, чтобы параллельные загрузки не смешали данные.
        await t.execute('UPDATE OZON_TARIFF_SOURCE SET KIND = KIND WHERE KIND = ?', [kind], false);
    }

    private async saveSource(
        t: Awaited<ReturnType<FirebirdPool['getTransaction']>>,
        kind: Kind,
        meta: ReturnType<typeof sourceMetadata>,
        count: number,
        matched: number | null,
        missing: number | null,
    ) {
        await t.execute(
            'UPDATE OZON_TARIFF_SOURCE SET FILE_NAME = ?, FILE_DATE = ?, UPLOADED_AT = ?, FILE_HASH = ?, ROWS_COUNT = ?, MATCHED_COUNT = ?, MISSING_COUNT = ? WHERE KIND = ?',
            [meta.filename, meta.fileDate, meta.uploadedAt, meta.hash, count, matched, missing, kind],
            false,
        );
    }

    /** Типы всех товаров кабинета, включая товары без остатка. Ошибка чтения не означает пустой каталог. */
    private async catalogTypeIds(): Promise<Set<number>> {
        try {
            const offers = await this.products.listAllOfferIds();
            if (!offers.length || new Set(offers).size !== offers.length || offers.some((offer) => !offer))
                throw new Error('Пустой или неоднозначный список товаров');
            const types = new Set<number>();
            for (let i = 0; i < offers.length; i += 100) {
                const batch = offers.slice(i, i + 100);
                const cards = await this.products.infoList(batch);
                const found = new Set(cards?.map((card) => card.sku));
                if (
                    !cards ||
                    cards.length !== batch.length ||
                    found.size !== batch.length ||
                    batch.some((offer) => !found.has(offer))
                )
                    throw new Error('Получены не все карточки товаров');
                for (const card of cards) {
                    if (!Number.isSafeInteger(card.typeId) || card.typeId <= 0)
                        throw new Error(`Не определён тип товара ${card.sku}`);
                    types.add(card.typeId);
                }
            }
            return types;
        } catch (e) {
            throw new ServiceUnavailableException(
                'Не удалось проверить все товары кабинета. Прежние тарифы сохранены.',
            );
        }
    }

    async importCommissions(buffer: Buffer, filename: string) {
        const meta = sourceMetadata(buffer, filename);
        const rows = await parseCommissions(buffer);
        const [tree, requiredTypes] = await Promise.all([
            this.ozonApi.method('/v1/description-category/tree', {}),
            this.catalogTypeIds(),
        ]);
        const currentTypes = commissionTypesFromTree(tree);
        return this.transaction(async (t) => {
            await this.lock(t, 'commissions');
            const types = await t.query(
                'SELECT TYPE_ID, TYPE_NAME, CATEGORY_PATH, DISABLED FROM OZON_TYPES',
                [],
                false,
            );
            const { updates, missing, retired } = matchCommissions(rows, types, currentTypes, requiredTypes);
            // Полная замена: типы, отсутствующие в новом файле, не должны сохранять ставки старого файла.
            await t.execute('UPDATE OZON_TYPES SET FBO_COMMISSIONS = NULL, FBS_COMMISSIONS = NULL', [], false);
            await this.blocks(
                t,
                updates.map(
                    (u) =>
                        `UPDATE OZON_TYPES SET FBO_COMMISSIONS = ${quote(JSON.stringify(u.fbo))}, FBS_COMMISSIONS = ${quote(JSON.stringify(u.fbs))}, DISABLED = 0 WHERE TYPE_ID = ${Number(u.typeId)};`,
                ),
            );
            await this.blocks(
                t,
                retired.map((t) => `UPDATE OZON_TYPES SET DISABLED = 1 WHERE TYPE_ID = ${Number(t.id)};`),
            );
            await this.saveSource(t, 'commissions', meta, rows.length, updates.length, retired.length);
            return {
                updated: updates.length,
                rows: rows.length,
                missingCount: missing.length,
                missingTypes: missing,
                retiredCount: retired.length,
                retiredTypes: retired,
                ...meta,
            };
        });
    }

    async importLogistics(buffer: Buffer, filename: string) {
        const meta = sourceMetadata(buffer, filename);
        const rows = await parseLogistics(buffer);
        return this.transaction(async (t) => {
            await this.lock(t, 'logistics');
            await t.execute('DELETE FROM OZON_LOGISTICS_TARIFF', [], false);
            await this.blocks(
                t,
                rows.map(
                    (r) => `INSERT INTO OZON_LOGISTICS_TARIFF
                (VOLUME_FROM, VOLUME_TO, ORIGIN_CLUSTER, DESTINATION_CLUSTER, IS_DEFAULT, PRICE_FROM, PRICE_FROM_INCLUDED, PRICE_TO, PRICE_TO_INCLUDED, AMOUNT)
                VALUES (${r.volumeFrom}, ${sqlNumber(r.volumeTo)}, ${quote(r.origin)}, ${quote(r.destination)}, ${Number(r.isDefault)}, ${r.band.min}, ${Number(r.band.minIncluded)}, ${sqlNumber(r.band.max)}, ${Number(r.band.maxIncluded)}, ${r.amount});`,
                ),
            );
            const defaultRates = rows.filter((r) => r.isDefault).length;
            await this.saveSource(t, 'logistics', meta, rows.length, null, null);
            return { rows: rows.length, routeRates: rows.length - defaultRates, defaultRates, ...meta };
        });
    }

    /** Только чтение: актуальная версия импорта и все ценовые ступени нужного объёма. */
    async logistics(volume: number): Promise<{ loaded: boolean; revision: string | null; rows: LogisticsRow[] }> {
        if (!Number.isFinite(volume) || volume <= 0) throw new Error('Нужен положительный объём в литрах');
        // XLSX задаёт границы с шагом 0,001 л: 0–0,2, затем 0,201–0,4.
        const rounded = Math.ceil(volume * 1000 - 1e-8) / 1000;
        const t = await this.pool.getTransaction(ISOLATION_READ_COMMITTED_READ_ONLY);
        try {
            const metadata = () =>
                t.query("SELECT FILE_HASH FROM OZON_TARIFF_SOURCE WHERE KIND = 'logistics'", [], false);
            const source = await metadata();
            const revision = source[0]?.FILE_HASH?.trim();
            if (!revision) return { loaded: false, revision: null, rows: [] };
            const key = `${revision}:${rounded}`;
            let rows = this.logisticsCache.get(key);
            if (!rows) {
                const data = await t.query(
                    'SELECT VOLUME_FROM, VOLUME_TO, ORIGIN_CLUSTER, DESTINATION_CLUSTER, IS_DEFAULT, PRICE_FROM, PRICE_FROM_INCLUDED, PRICE_TO, PRICE_TO_INCLUDED, AMOUNT FROM OZON_LOGISTICS_TARIFF WHERE VOLUME_FROM <= ? AND (VOLUME_TO IS NULL OR VOLUME_TO >= ?)',
                    [rounded, rounded],
                    false,
                );
                rows = data.map((r) => ({
                    volumeFrom: r.VOLUME_FROM,
                    volumeTo: r.VOLUME_TO,
                    origin: r.ORIGIN_CLUSTER.trim(),
                    destination: r.DESTINATION_CLUSTER.trim(),
                    isDefault: r.IS_DEFAULT === 1,
                    band: {
                        min: r.PRICE_FROM,
                        max: r.PRICE_TO,
                        minIncluded: r.PRICE_FROM_INCLUDED === 1,
                        maxIncluded: r.PRICE_TO_INCLUDED === 1,
                    },
                    amount: r.AMOUNT,
                }));
            }
            if ((await metadata())[0]?.FILE_HASH?.trim() !== revision)
                throw new Error('Тарифы изменились во время чтения; повторите расчёт');
            if (this.logisticsCache.size > 1000) this.logisticsCache.clear();
            this.logisticsCache.set(key, rows);
            return { loaded: true, revision, rows };
        } catch (e) {
            if (/table unknown|relation.*not.*defined/i.test(e.message ?? ''))
                return { loaded: false, revision: null, rows: [] };
            throw e;
        } finally {
            await t.rollback(true);
        }
    }

    async info() {
        return this.transaction(async (t) => {
            const rows = await t.query(
                'SELECT KIND, FILE_NAME, FILE_DATE, UPLOADED_AT, ROWS_COUNT, MATCHED_COUNT, MISSING_COUNT FROM OZON_TARIFF_SOURCE ORDER BY KIND',
                [],
                false,
            );
            return rows.map((r) => {
                const fileDate =
                    r.FILE_DATE instanceof Date
                        ? `${r.FILE_DATE.getFullYear()}-${String(r.FILE_DATE.getMonth() + 1).padStart(2, '0')}-${String(r.FILE_DATE.getDate()).padStart(2, '0')}`
                        : r.FILE_DATE
                          ? String(r.FILE_DATE).slice(0, 10)
                          : null;
                return {
                    kind: String(r.KIND).trim(),
                    filename: r.FILE_NAME || null,
                    fileDate,
                    uploadedAt: r.UPLOADED_AT || null,
                    rows: r.ROWS_COUNT || 0,
                    matchedCount: r.MATCHED_COUNT,
                    retiredCount: r.MISSING_COUNT,
                    stale: !fileDate || Date.now() - new Date(`${fileDate}T00:00:00+03:00`).getTime() > 7 * 86400_000,
                };
            });
        });
    }

    @Cron('0 0 9 * * *', { name: 'ozonTariffReminder', timeZone: 'Europe/Moscow' })
    async remind() {
        if (this.config.get<string>('NODE_ENV') !== 'production') return;
        try {
            const stale = (await this.info()).filter((r) => r.stale);
            if (!stale.length) return;
            const names = stale.map(
                (r) => `${r.kind === 'commissions' ? 'Комиссии' : 'Доставка'}: ${r.fileDate || 'файл не загружен'}`,
            );
            await this.notifier.notify(
                NotifyTopic.PRICES,
                {
                    subject: 'Загрузите новые тарифы Ozon',
                    text: `Загрузите новые тарифы Ozon в админке («Цены» → «Тарифы Ozon»).\n${names.join('\n')}`,
                },
                ['matrix'],
            );
        } catch (e) {
            this.logger.error(`Не удалось проверить возраст тарифов Ozon: ${e.message}`);
        }
    }
}
