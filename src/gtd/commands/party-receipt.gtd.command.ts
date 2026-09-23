import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGtdContext } from '../gtd.context';
import { receiptGtdExpr } from '../receipt.gtd.sql';

/**
 * Источник 1: приход САМОЙ партии. Когда приходный документ есть, его номер и есть правда,
 * дальше по цепочке идти незачем.
 *
 * Знает только «где взять». Про формат Озона и про то, кто следующий, не знает ничего.
 */
@Injectable()
export class PartyReceiptGtdCommand implements ICommandAsync<IGtdContext> {
    async execute(ctx: IGtdContext): Promise<IGtdContext> {
        const rows = await ctx.transaction.query(
            `SELECT ${receiptGtdExpr('pm')} AS GTD FROM PR_META pm WHERE pm.ID = ?`,
            [ctx.partyId],
            false,
        );
        ctx.candidates = rows?.[0]?.GTD != null ? [String(rows[0].GTD)] : [];
        return ctx;
    }
}
