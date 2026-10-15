import { Module } from '@nestjs/common';
import { MpEventService } from './mp-event.service';
import { MpReturnAcceptStore } from './mp-return-accept.store';
import { FirebirdModule } from '../firebird/firebird.module';

@Module({
    imports: [FirebirdModule],
    providers: [MpEventService, MpReturnAcceptStore],
    exports: [MpEventService, MpReturnAcceptStore],
})
export class MpEventModule {}
