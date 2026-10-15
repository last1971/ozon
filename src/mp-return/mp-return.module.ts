import { Module } from '@nestjs/common';
import { InvoiceModule } from '../invoice/invoice.module';
import { MpEventModule } from '../mp-event/mp-event.module';
import { PostingModule } from '../posting/posting.module';
import { MpReturnController } from './mp-return.controller';
import { MpReturnService } from './mp-return.service';
import { MpReturnChainFactory } from './mp-return.chain.factory';
import { ReturnCardBuilder } from './return-card.builder';
import { OzonReturnSource } from './sources/ozon.return.source';
import { RETURN_SOURCES } from './sources/i.return.source';
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
import { AssertWriteOffAllowedCommand } from './commands/assert-write-off-allowed.command';
import { AllocateSpisCodeCommand } from './commands/allocate-spis-code.command';
import { StampMarksForSpisCommand } from './commands/stamp-marks-for-spis.command';
import { CreateWriteOffDocCommand } from './commands/create-write-off-doc.command';
import { RecordWriteOffCommand } from './commands/record-write-off.command';

/** Экран приёма возвратов маркетплейсов (план marking/sprint/returns_accept_PLAN.md). */
@Module({
    imports: [InvoiceModule, MpEventModule, PostingModule],
    controllers: [MpReturnController],
    providers: [
        MpReturnService,
        MpReturnChainFactory,
        ReturnCardBuilder,
        OzonReturnSource,
        { provide: RETURN_SOURCES, useFactory: (ozon: OzonReturnSource) => [ozon], inject: [OzonReturnSource] },
        LoadReturnCardCommand,
        AssertNotProcessedCommand,
        AssertAcceptableCommand,
        AssertProblemCommentCommand,
        ValidateMarksCommand,
        UnretireMarksCommand,
        ReleaseMarksCommand,
        DisbandPodbCommand,
        RestateInvoiceCommand,
        RecordAcceptCommand,
        AssertWriteOffAllowedCommand,
        AllocateSpisCodeCommand,
        StampMarksForSpisCommand,
        CreateWriteOffDocCommand,
        RecordWriteOffCommand,
    ],
})
export class MpReturnModule {}
