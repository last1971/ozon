import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { DonorPiecesStore } from '../donor-pieces.store';
import { DonorPiecesContext } from '../donor-pieces.types';

/** 1. Живые счета-доноры FORFBO своего покупателя Озона, где есть строка без фасовки. Нет таких — дальше нечего делать. */
@Injectable()
export class LoadDonorsCommand implements ICommandAsync<DonorPiecesContext> {
    constructor(private readonly store: DonorPiecesStore) {}

    async execute(ctx: DonorPiecesContext): Promise<DonorPiecesContext> {
        const invoices = await this.store.loadDonors(ctx.buyerId);
        return { ...ctx, invoices, results: [], stopChain: invoices.length === 0 };
    }
}
