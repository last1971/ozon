import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IPickupContext } from './i.pickup.context';
import { INVOICE_SERVICE, IInvoice } from '../../interfaces/IInvoice';

/**
 * Зовёт руки, когда маркируемый товар уезжает без КМ.
 *
 * Коды привязывает только скан, а подбор закрывает крон — несканированный товар уходит,
 * код остаётся свободным и всплывает фантомом на витрине (549853, счёт №18034 от 09.09.2026).
 * Подбор не блокируем: иначе вернётся регресс с сотнями счетов, зависших в STATUS=3.
 *
 * Проверяем только счёт в STATUS=3 — по подобранному письмо уходило бы на каждом прогоне.
 */
@Injectable()
export class CheckMarkCoverageCommand implements ICommandAsync<IPickupContext> {
    private readonly logger = new Logger(CheckMarkCoverageCommand.name);

    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async execute(context: IPickupContext): Promise<IPickupContext> {
        const { invoice } = context;
        if (invoice.status !== 3) return context;

        let uncovered: IPickupContext['uncovered'];
        try {
            uncovered = await this.invoiceService.getUncoveredMarkLines(invoice.id, context.transaction);
        } catch (e) {
            // Проверка — не повод ронять подбор: счёт важнее письма.
            this.logger.warn(`${invoice.remark}: не удалось проверить покрытие КМ — ${e.message}`);
            return context;
        }
        if (!uncovered.length) return context;

        const details = uncovered
            .map((line) => `товар ${line.goodscode}: нужно ${line.needed}, привязано ${line.attached}`)
            .join('; ');
        this.logger.warn(`${invoice.remark}: подбор закрыт без КМ — ${details}`);
        this.eventEmitter.emit(
            'error.message',
            'Подбор закрыт без кодов маркировки',
            `${invoice.remark}: счёт №${invoice.number ?? '?'} (SCODE ${invoice.id}) подобран автоматикой,` +
                ` но коды не привязаны — ${details}.` +
                ' Товар уезжает, коды остаются свободными и всплывут на витрине — нужна догоняющая проводка.',
        );

        return { ...context, uncovered };
    }
}
