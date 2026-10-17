import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ICommandAsync } from '../../../interfaces/i.command.acync';
import { ProfitCheckContext } from '../profit-check.types';

/**
 * 5. Одно сообщение на проход: тревоги, предупреждения, «не проверено». Норма — молча.
 * Отправка — событием в NotifierService (тема «цены»; с тревогой — пуш, без — тихо).
 */
@Injectable()
export class NotifyCommand implements ICommandAsync<ProfitCheckContext> {
    constructor(private readonly eventEmitter: EventEmitter2) {}

    async execute(ctx: ProfitCheckContext): Promise<ProfitCheckContext> {
        const report = ctx.items.filter((i) => !i.deferred && i.level && i.level !== 'ok');
        if (report.length) this.eventEmitter.emit('profit.check', report);
        return ctx;
    }
}
