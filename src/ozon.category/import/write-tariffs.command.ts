import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FirebirdPool } from 'ts-firebird';
import { FIREBIRD } from '../../firebird/firebird.module';
import { IJobCommand } from '../../interfaces/i.job.context';
import { jobCheckpoint } from '../../job/job.checkpoint';
import { matchCommissions } from '../tariff.xlsx';
import { TariffImportContext } from './tariff-import.context';

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlNumber = (n: number | null) => (n === null ? 'NULL' : String(n));

@Injectable()
export class WriteTariffsCommand implements IJobCommand<TariffImportContext> {
    readonly phase = 'запись в Firebird';
    readonly weight = 45;
    constructor(@Inject(FIREBIRD) private readonly pool: FirebirdPool) {}

    async execute(context: TariffImportContext): Promise<TariffImportContext> {
        await jobCheckpoint(context);
        if (!this.pool) throw new ServiceUnavailableException('Нет подключения к базе.');
        const t = (context.transaction = await this.pool.getTransaction());
        const source = await t.query('SELECT KIND FROM OZON_TARIFF_SOURCE WHERE KIND = ?', [context.kind], false);
        if (!source.length)
            throw new ServiceUnavailableException('Нет служебной записи тарифов. Проверьте SQL-патч этапа 2.');
        await t.execute('UPDATE OZON_TARIFF_SOURCE SET KIND = KIND WHERE KIND = ?', [context.kind], false);
        let statements: Iterable<string>;
        if (context.kind === 'commissions') {
            // Справочник читается под блокировкой импорта; проверка своего каталога — до очистки старых ставок.
            const types = await t.query(
                'SELECT TYPE_ID, TYPE_NAME, CATEGORY_PATH, DISABLED FROM OZON_TYPES',
                [],
                false,
            );
            const { updates, missing, retired } = matchCommissions(
                context.commissions,
                types,
                context.currentTypes,
                context.requiredTypes,
            );
            context.result = {
                ...context.meta,
                rows: context.commissions.length,
                updated: updates.length,
                missingCount: missing.length,
                missingTypes: missing,
                retiredCount: retired.length,
                retiredTypes: retired,
            };
            context.progress.total = updates.length + retired.length;
            await t.execute('UPDATE OZON_TYPES SET FBO_COMMISSIONS = NULL, FBS_COMMISSIONS = NULL', [], false);
            statements = (function* () {
                for (const u of updates)
                    yield `UPDATE OZON_TYPES SET FBO_COMMISSIONS = ${quote(JSON.stringify(u.fbo))}, FBS_COMMISSIONS = ${quote(JSON.stringify(u.fbs))}, DISABLED = 0 WHERE TYPE_ID = ${Number(u.typeId)};`;
                for (const type of retired)
                    yield `UPDATE OZON_TYPES SET DISABLED = 1 WHERE TYPE_ID = ${Number(type.id)};`;
            })();
        } else {
            const rows = context.logistics;
            const defaultRates = rows.filter((r) => r.isDefault).length;
            context.result = {
                ...context.meta,
                rows: rows.length,
                routeRates: rows.length - defaultRates,
                defaultRates,
            };
            context.progress.total = rows.length;
            await t.execute('DELETE FROM OZON_LOGISTICS_TARIFF', [], false);
            statements = (function* () {
                for (const r of rows)
                    yield `INSERT INTO OZON_LOGISTICS_TARIFF
                    (VOLUME_FROM, VOLUME_TO, ORIGIN_CLUSTER, DESTINATION_CLUSTER, IS_DEFAULT, PRICE_FROM, PRICE_FROM_INCLUDED, PRICE_TO, PRICE_TO_INCLUDED, AMOUNT)
                    VALUES (${r.volumeFrom}, ${sqlNumber(r.volumeTo)}, ${quote(r.origin)}, ${quote(r.destination)}, ${Number(r.isDefault)}, ${r.band.min}, ${Number(r.band.minIncluded)}, ${sqlNumber(r.band.max)}, ${Number(r.band.maxIncluded)}, ${r.amount});`;
            })();
        }
        let batch: string[] = [];
        const flush = async () => {
            await jobCheckpoint(context);
            await t.execute(`EXECUTE BLOCK AS BEGIN\n${batch.join('\n')}\nEND`, [], false);
            context.progress.done += batch.length;
            context.progress.counters.written = context.progress.done;
            batch = [];
        };
        for (const statement of statements) {
            batch.push(statement);
            if (batch.length === 20) await flush();
        }
        if (batch.length) await flush();
        return context;
    }
}
