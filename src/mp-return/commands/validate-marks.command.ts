import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { extractKi } from '../../helpers';
import { ReturnRefusedError } from '../return-refused.error';
import { AcceptContext } from './return.contexts';

/**
 * 4. Марки: на строке есть коды → отсканированные коды этой строки покрывают ровно вернувшиеся штуки
 * (количественный код считается своим QUANTITY: 20 шт = 2 марки по 10). Кодов на строке нет — сканов быть не должно.
 */
@Injectable()
export class ValidateMarksCommand implements ICommandAsync<AcceptContext> {
    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const kis = [...new Set(ctx.scans.map((raw) => extractKi(raw)).filter(Boolean))];
        const { card } = ctx;
        if (!card.marksRequired) {
            if (kis.length) throw new ReturnRefusedError('Марки не нужны: к строке счёта коды не привязаны');
            return { ...ctx, kis: [] };
        }
        const byKi = new Map(card.codes.map((c) => [c.ki, c]));
        const foreign = kis.filter((ki) => !byKi.has(ki));
        if (foreign.length) throw new ReturnRefusedError(`Код не с этой строки счёта: ${foreign.join(', ')}`);
        const pieces = kis.reduce((sum, ki) => sum + byKi.get(ki).quantity, 0);
        if (pieces !== card.quan) {
            throw new ReturnRefusedError(`Отсканировано марок на ${pieces} шт, вернулось ${card.quan}`);
        }
        return { ...ctx, kis };
    }
}
