import { Injectable } from '@nestjs/common';
import { FirebirdTransaction } from 'ts-firebird';
import { ICommandAsync } from '../interfaces/i.command.acync';
import { IGtdContext } from './gtd.context';
import { OzonGtdFormat } from './ozon.gtd.format';
import { PartyReceiptGtdCommand } from './commands/party-receipt.gtd.command';
import { LastGoodReceiptGtdCommand } from './commands/last-good-receipt.gtd.command';

/** Приходная партия, для которой ищем ГТД. */
export interface IGtdParty {
    partyId: number;
    goodscode: string;
    partyDate: Date | null;
}

/**
 * Распорядитель: идёт по источникам ПО ПОРЯДКУ и возвращает первый ГОДНЫЙ номер.
 *
 * Порядок источников = приоритет, и живёт он ровно здесь, одним списком. Новый источник —
 * новая команда плюс строка в этом списке; ни источники, ни вызывающий код не трогаются.
 *
 * CommandChainAsync не подошёл намеренно: он прогоняет цепочку до конца или до stopChain,
 * а здесь решение «идти дальше или нет» принимается МЕЖДУ шагами и зависит от формата —
 * знания, которого у команд нет и не должно быть.
 */
@Injectable()
export class GtdResolver {
    private readonly sources: ICommandAsync<IGtdContext>[];

    constructor(
        private readonly format: OzonGtdFormat,
        partyReceipt: PartyReceiptGtdCommand,
        lastGoodReceipt: LastGoodReceiptGtdCommand,
    ) {
        this.sources = [partyReceipt, lastGoodReceipt];
    }

    async resolve(party: IGtdParty, transaction: FirebirdTransaction): Promise<string | null> {
        const ctx: IGtdContext = { ...party, transaction, candidates: [] };
        for (const source of this.sources) {
            ctx.candidates = [];
            await source.execute(ctx);
            for (const raw of ctx.candidates) {
                const gtd = this.format.normalize(raw);
                if (gtd) return gtd;
            }
        }
        return null;
    }
}
