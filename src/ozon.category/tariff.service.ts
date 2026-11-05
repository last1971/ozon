import { TariffImportService } from './import/tariff-import.service';
import { TariffKind } from './import/tariff-import.context';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FirebirdPool, ISOLATION_READ_COMMITTED_READ_ONLY } from 'ts-firebird';
import type { LogisticsRow } from './tariff.xlsx';
import { FIREBIRD } from '../firebird/firebird.module';
import { NotifierService } from '../notify/notifier.service';
import { NotifyTopic } from '../notify/notify.types';

@Injectable()
export class OzonTariffService {
    private readonly logisticsCache = new Map<string, LogisticsRow[]>();
    private readonly logger = new Logger(OzonTariffService.name);
    constructor(
        @Inject(FIREBIRD) private readonly pool: FirebirdPool,
        private readonly notifier: NotifierService,
        private readonly config: ConfigService,
        private readonly imports: TariffImportService,
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

    startImport(kind: TariffKind, buffer: Buffer, filename: string, clientId?: string) {
        return this.imports.start(kind, buffer, filename, clientId);
    }

    importCommissions(buffer: Buffer, filename: string) {
        return this.imports.import('commissions', buffer, filename);
    }

    importLogistics(buffer: Buffer, filename: string) {
        return this.imports.import('logistics', buffer, filename);
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
