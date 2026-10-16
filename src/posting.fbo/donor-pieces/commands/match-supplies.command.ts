import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { matchSupply } from '../donor-pieces.matcher';
import { DonorPiecesContext, DonorPiecesResult } from '../donor-pieces.types';

/** 3. Сопоставить каждый счёт с его поставкой и получить итог: что писать и что спорно. */
@Injectable()
export class MatchSuppliesCommand implements ICommandAsync<DonorPiecesContext> {
    async execute(ctx: DonorPiecesContext): Promise<DonorPiecesContext> {
        const results: DonorPiecesResult[] = (ctx.invoices ?? []).map((invoice) => {
            const base = { invoice, fills: [], disputes: [] };
            if (!invoice.supplyNumber) return { ...base, outcome: 'NO_NUMBER' };
            const supply = ctx.supplies?.get(invoice.supplyNumber);
            if (!supply || supply.kind === 'error')
                return { ...base, outcome: 'OZON_ERROR', error: supply?.kind === 'error' ? supply.message : 'нет ответа' };
            if (supply.kind === 'not_found') return { ...base, outcome: 'NOT_FOUND' };
            const { fills, disputes } = matchSupply(invoice, supply.items);
            return { invoice, fills, disputes, outcome: disputes.length ? 'DISPUTE' : 'DONE' };
        });
        return { ...ctx, results };
    }
}
