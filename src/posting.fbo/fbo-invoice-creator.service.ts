import { Injectable } from '@nestjs/common';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { IFboCreateContext } from './commands/i.fbo-create.context';
import { CreateFboInvoiceCommand } from './commands/create-fbo-invoice.command';
import { LogShortageNotifyCommand } from './commands/log-shortage-notify.command';
import { InvoiceDto } from '../invoice/dto/invoice.dto';

/**
 * Единая точка создания FBO-счёта для Ozon и WB: создать счёт (+собрать недостачи) → журнал+письмо
 * по недобору. Недостача не списывает товар и не отменяет заказ (спишут вручную). WB «левый» заказ
 * без подбора → счёт не создаётся (create вернёт null, stopChain).
 */
@Injectable()
export class FboInvoiceCreatorService {
    private readonly chain: CommandChainAsync<IFboCreateContext>;

    constructor(create: CreateFboInvoiceCommand, logNotify: LogShortageNotifyCommand) {
        this.chain = new CommandChainAsync<IFboCreateContext>([create, logNotify]);
    }

    /** Возвращает созданный счёт либо null («левый» WB-заказ без подбора). */
    async create(context: IFboCreateContext): Promise<InvoiceDto | null> {
        const result = await this.chain.execute(context);
        return result.invoice ?? null;
    }
}
