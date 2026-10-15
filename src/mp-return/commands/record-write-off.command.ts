import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { MpReturnAcceptStore } from '../../mp-event/mp-return-accept.store';
import { WriteOffContext } from './return.contexts';

/** Отметка о списании в журнале приёма: номер документа и склад (генераторы склада и магазина раздельные). */
@Injectable()
export class RecordWriteOffCommand implements ICommandAsync<WriteOffContext> {
    constructor(
        private readonly store: MpReturnAcceptStore,
        @Inject(RETURN_STOCK) private readonly stock: IReturnStock,
    ) {}

    async execute(ctx: WriteOffContext): Promise<WriteOffContext> {
        const rec = await this.store.find(ctx.service, ctx.extId, ctx.t);
        await this.store.setWriteOff(rec.id, ctx.spisCode, this.stock.storageSS(), ctx.t);
        return ctx;
    }
}
