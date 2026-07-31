import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IInvoice, INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { IFboCreateContext } from './i.fbo-create.context';

/**
 * Недобор по счёту (позиция без подбора / недокинутый migrate-остаток) → журнал FBO_SHORTAGE + письмо.
 * Счёт НЕ трогаем (он уже создан на что было), deltaGood больше нет — недобор спишут вручную.
 */
@Injectable()
export class LogShortageNotifyCommand implements ICommandAsync<IFboCreateContext> {
    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async execute(context: IFboCreateContext): Promise<IFboCreateContext> {
        const shortages = context.shortages ?? [];
        if (shortages.length === 0) return context;

        const posting = context.posting.posting_number;
        for (const s of shortages) {
            await this.invoiceService.logShortage(
                context.service,
                posting,
                s.goodscode,
                s.quantity,
                context.primLabel,
                context.transaction,
            );
        }

        const positions = shortages.map((s) => `${s.goodscode} × ${s.quantity}`).join('; ');
        const subject = `${context.service.toUpperCase()} FBO: недобор по складу — спишите вручную`;
        const body = [
            `Маркет: ${context.service}`,
            `Заказ: ${posting}`,
            `Недобор позиций: ${positions}`,
            `Склад: ${context.primLabel || '-'}`,
            'Счёт создан, недокинутый товар не списан — спишите вручную.',
        ].join('\n');

        // Письмо шлём после commit транзакции (через flushers) — чтобы не уведомлять при откате.
        const send = async () => {
            this.eventEmitter.emit('error.message', subject, body);
        };
        if (context.flushers) context.flushers.push(send);
        else await send();

        return context;
    }
}
