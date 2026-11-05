import type Excel from 'exceljs';
import type { FirebirdPool } from 'ts-firebird';
import type { IJobContext } from '../../interfaces/i.job.context';
import type { CommissionRow, CommissionType, LogisticsRow, TariffLayout, sourceMetadata } from '../tariff.xlsx';

export type TariffKind = 'commissions' | 'logistics';
export const tariffImportJob = (kind: TariffKind) => `ozon-tariffs-${kind}`;
export interface TariffImportResult extends ReturnType<typeof sourceMetadata> {
    rows: number;
    updated?: number;
    missingCount?: number;
    missingTypes?: { id: number; name: string }[];
    retiredCount?: number;
    retiredTypes?: { id: number; name: string }[];
    routeRates?: number;
    defaultRates?: number;
}
export interface TariffImportContext extends IJobContext {
    kind: TariffKind;
    buffer: Buffer;
    filename: string;
    workbook?: Excel.Workbook;
    layouts?: TariffLayout[];
    meta?: ReturnType<typeof sourceMetadata>;
    currentTypes?: Map<number, CommissionType>;
    requiredTypes?: Set<number>;
    commissions?: CommissionRow[];
    logistics?: LogisticsRow[];
    transaction?: Awaited<ReturnType<FirebirdPool['getTransaction']>>;
    committing?: boolean;
    result?: TariffImportResult;
}
