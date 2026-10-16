import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { AcceptContext } from './return.contexts';

/**
 * 4. Марки: на строке есть коды → из отсканированного на кнопку забираются коды этой строки ровно на
 * вернувшиеся штуки (количественный код считается своим QUANTITY: 20 шт = 2 марки по 10).
 * Лишние и чужие сканы проверяет пул после всех возвратов кнопки.
 */
@Injectable()
export class ValidateMarksCommand implements ICommandAsync<AcceptContext> {
    async execute(ctx: AcceptContext): Promise<AcceptContext> {
        const { card } = ctx;
        return { ...ctx, kis: ctx.marks.take(card.marksRequired ? card.codes : null, card.quan) };
    }
}
