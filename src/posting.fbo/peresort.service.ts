import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { NotifyTopic } from '../notify/notify.types';
import { FboShortagePeresortDto, FboShortagePeresortResultDto } from './dto/fbo-shortage-peresort.dto';
import { PeresortContext } from './peresort/peresort.context';
import { LoadShortageLineCommand } from './peresort/load-shortage-line.command';
import { AssertNotMarkedCommand } from './peresort/assert-not-marked.command';
import { BuildPeresortDocCommand } from './peresort/build-peresort-doc.command';
import { AllocateSpisCodeCommand } from '../helpers/spis/allocate-spis-code.command';
import { CreateSpisDocCommand } from '../helpers/spis/create-spis-doc.command';
import { inTransaction } from '../helpers/transaction';
import { PickupLineCommand } from './peresort/pickup-line.command';
import { CloseShortageCommand } from './peresort/close-shortage.command';

/**
 * Кнопка «Пересортица и подбор» на экране недоборов FBO: доноров нет — недостающее приходуем
 * пересортицей на весь недобор и тут же подбираем в счёт (решение владельца 16.10.2026:
 * сперва пересортица, потом подбор; маркируемому кнопки нет). Состав и порядок шагов известны
 * только здесь; всё в одной транзакции, всё или ничего.
 */
@Injectable()
export class PeresortService {
    private readonly logger = new Logger(PeresortService.name);

    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly load: LoadShortageLineCommand,
        private readonly notMarked: AssertNotMarkedCommand,
        private readonly buildDoc: BuildPeresortDocCommand,
        private readonly allocateSpisCode: AllocateSpisCodeCommand,
        private readonly createDoc: CreateSpisDocCommand,
        private readonly pickup: PickupLineCommand,
        private readonly closeShortage: CloseShortageCommand,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    chain(): CommandChainAsync<PeresortContext> {
        return new CommandChainAsync<PeresortContext>([
            this.load,
            this.notMarked,
            this.buildDoc,
            this.allocateSpisCode,
            this.createDoc,
            this.pickup,
            this.closeShortage,
        ]);
    }

    async apply(posting: string, dto: FboShortagePeresortDto): Promise<FboShortagePeresortResultDto> {
        const ctx = await inTransaction(
            () => this.invoiceService.getTransaction(),
            (t) =>
                this.chain().execute({
                    t,
                    posting,
                    scode: Number(dto.scode),
                    realpricecode: Number(dto.realpricecode),
                    username: dto.username.trim(),
                }),
        );

        const what = `${ctx.line.name ?? ctx.line.goodscode} × ${ctx.quantity}`;
        this.logger.log(
            `[peresort] ${posting} SCODE ${ctx.scode}: ${what}, документ ${ctx.spisCode}; журнал ${ctx.shortageClosed ? 'закрыт' : 'не закрыт'}`,
        );
        this.eventEmitter.emit(
            'error.message',
            'FBO: недобор закрыт пересортицей',
            `Заказ: ${posting}\nСчёт: SCODE ${ctx.scode}\nОприходовано и подобрано: ${what}\nДокумент списания: ${ctx.spisCode}\nОформил: ${ctx.username}\n` +
                (ctx.shortageClosed
                    ? 'Недобора не осталось, счёт отдан в подбор.'
                    : 'По другим позициям недобор ещё открыт.'),
            NotifyTopic.OPS,
        );
        return {
            posting,
            scode: ctx.scode,
            realpricecode: ctx.realpricecode,
            goodscode: ctx.line.goodscode,
            quantity: ctx.quantity,
            spisCode: ctx.spisCode,
            shortageClosed: ctx.shortageClosed,
            pickedUp: ctx.pickedUp,
        };
    }
}
