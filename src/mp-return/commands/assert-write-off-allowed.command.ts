import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IReturnStock, RETURN_STOCK } from '../../interfaces/i.return.stock';
import { MpReturnAcceptStore } from '../../mp-event/mp-return-accept.store';
import { ReturnRefusedError } from '../return-refused.error';
import { WriteOffContext } from './return.contexts';

/**
 * Списать можно: строка принята возвратом и ещё не списана; маркируемый товар без марок на строке при
 * свободных кодах — нельзя (решение владельца 15.10: «спишите в Trade со сканом»); не хватает остатка
 * сверх резерва — нельзя (как Delphi: правка резерва — в Trade). Свободу самих марок проверяет процедура штампа.
 */
@Injectable()
export class AssertWriteOffAllowedCommand implements ICommandAsync<WriteOffContext> {
    constructor(
        private readonly store: MpReturnAcceptStore,
        @Inject(RETURN_STOCK) private readonly stock: IReturnStock,
    ) {}

    async execute(ctx: WriteOffContext): Promise<WriteOffContext> {
        const rec = await this.store.find(ctx.service, ctx.extId, ctx.t);
        if (!rec || rec.decision !== 'RETURN') throw new ReturnRefusedError('Списать можно только принятый возврат');
        if (rec.spisCode) throw new ReturnRefusedError(`Уже списан (документ ${rec.spisCode})`);
        if (!ctx.kis.length && (await this.stock.hasFreeMarkCodes(ctx.goodscode, ctx.t))) {
            throw new ReturnRefusedError('Маркируемый товар без марок на строке — спишите в Trade со сканом');
        }
        const { stock, reserved, reservedBy } = await this.stock.stockAndReserve(ctx.goodscode, ctx.t);
        if (ctx.quan + reserved > stock) {
            const by = reservedBy.length ? ` под счёт ${reservedBy.join(', ')}` : '';
            throw new ReturnRefusedError(
                `Товар в резерве${by}: на складе ${stock}, в резерве ${reserved}, списать ${ctx.quan} — спишите в Trade после правки резерва`,
            );
        }
        return ctx;
    }
}
