import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IncomingStore } from '../incoming.store';
import { IncomingContext } from '../incoming.types';

/** 2. Коды товаров этих приходов из таблицы прихода — в журнале их нет, там только номер документа. */
@Injectable()
export class LoadIncomingGoodsCommand implements ICommandAsync<IncomingContext> {
    constructor(private readonly store: IncomingStore) {}

    async execute(ctx: IncomingContext): Promise<IncomingContext> {
        const goodsByPrihod = await this.store.goodsByPrihod(ctx.prihods.map((p) => p.np));
        const skus = [...new Set([...goodsByPrihod.values()].flat())];
        return { ...ctx, skus, goodsByPrihod };
    }
}
