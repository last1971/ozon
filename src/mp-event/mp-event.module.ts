import { Module } from '@nestjs/common';
import { MpEventService } from './mp-event.service';
import { FirebirdModule } from '../firebird/firebird.module';

@Module({
    imports: [FirebirdModule],
    providers: [MpEventService],
    exports: [MpEventService],
})
export class MpEventModule {}
