import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { OzonSupplyClient } from '../ozon-supply.client';
import { DonorPiecesContext, SupplyLookup } from '../donor-pieces.types';

/**
 * 2. Состав каждой поставки из Озона — по одной, подряд: ручки поставок с лимитом,
 * а проход нужен один раз на счёт (заполненный счёт из выборки уходит).
 * Ошибка Озона по одной поставке не роняет проход — она уходит в итог этой поставки.
 */
@Injectable()
export class FetchSuppliesCommand implements ICommandAsync<DonorPiecesContext> {
    constructor(private readonly client: OzonSupplyClient) {}

    async execute(ctx: DonorPiecesContext): Promise<DonorPiecesContext> {
        const supplies = new Map<string, SupplyLookup>();
        for (const invoice of ctx.invoices ?? []) {
            const number = invoice.supplyNumber;
            if (!number || supplies.has(number)) continue;
            supplies.set(number, await this.client.lookup(number));
        }
        return { ...ctx, supplies };
    }
}
