import { Injectable } from '@nestjs/common';
import { CommandChainAsync } from '../helpers/command/command.chain.async';
import { ReturnAction } from './dto/return-request.dto';
import { AcceptContext, WriteOffContext } from './commands/return.contexts';
import { LoadReturnCardCommand } from './commands/load-return-card.command';
import { AssertNotProcessedCommand } from './commands/assert-not-processed.command';
import { AssertAcceptableCommand } from './commands/assert-acceptable.command';
import { AssertProblemCommentCommand } from './commands/assert-problem-comment.command';
import { ValidateMarksCommand } from './commands/validate-marks.command';
import { UnretireMarksCommand } from './commands/unretire-marks.command';
import { ReleaseMarksCommand } from './commands/release-marks.command';
import { DisbandPodbCommand } from './commands/disband-podb.command';
import { RestateInvoiceCommand } from './commands/restate-invoice.command';
import { RecordAcceptCommand } from './commands/record-accept.command';
import { RunWriteOffCommand } from './commands/run-write-off.command';
import { AssertWriteOffAllowedCommand } from './commands/assert-write-off-allowed.command';
import { AllocateSpisCodeCommand } from './commands/allocate-spis-code.command';
import { StampMarksForSpisCommand } from './commands/stamp-marks-for-spis.command';
import { CreateWriteOffDocCommand } from './commands/create-write-off-doc.command';
import { RecordWriteOffCommand } from './commands/record-write-off.command';

/**
 * Единственное место, где известен состав и порядок шагов каждой кнопки экрана возвратов.
 * Сервис и контроллер порядка не знают; составная кнопка — композиция готовых цепочек.
 */
@Injectable()
export class MpReturnChainFactory {
    constructor(
        private readonly load: LoadReturnCardCommand,
        private readonly notProcessed: AssertNotProcessedCommand,
        private readonly acceptable: AssertAcceptableCommand,
        private readonly problemComment: AssertProblemCommentCommand,
        private readonly validateMarks: ValidateMarksCommand,
        private readonly unretire: UnretireMarksCommand,
        private readonly release: ReleaseMarksCommand,
        private readonly disband: DisbandPodbCommand,
        private readonly restate: RestateInvoiceCommand,
        private readonly record: RecordAcceptCommand,
        private readonly writeOffAllowed: AssertWriteOffAllowedCommand,
        private readonly allocateSpisCode: AllocateSpisCodeCommand,
        private readonly stampMarks: StampMarksForSpisCommand,
        private readonly createDoc: CreateWriteOffDocCommand,
        private readonly recordWriteOff: RecordWriteOffCommand,
    ) {}

    /** Кнопка карточки: «Вернуть», «Вернуть и списать», «Проблема». */
    forAction(action: ReturnAction): CommandChainAsync<AcceptContext> {
        if (action === 'problem') {
            return new CommandChainAsync([this.load, this.notProcessed, this.problemComment, this.record]);
        }
        const accept = [
            this.load,
            this.notProcessed,
            this.acceptable,
            this.validateMarks,
            this.unretire,
            this.release,
            this.disband,
            this.restate,
            this.record,
        ];
        return new CommandChainAsync(
            action === 'return-writeoff' ? [...accept, new RunWriteOffCommand(this.writeOff())] : accept,
        );
    }

    /** Кнопка «Списать» у принятой строки — и вторая половина «Вернуть и списать». */
    writeOff(): CommandChainAsync<WriteOffContext> {
        return new CommandChainAsync([
            this.writeOffAllowed,
            this.allocateSpisCode,
            this.stampMarks,
            this.createDoc,
            this.recordWriteOff,
        ]);
    }
}
