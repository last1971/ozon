import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { Trade2006ChzService } from '../trade2006.chz/trade2006.chz.service';
import { ChzController } from './chz.controller';
import { ChzService } from './chz.service';

@Module({
    imports: [FirebirdModule],
    providers: [Trade2006ChzService, ChzService],
    controllers: [ChzController],
    exports: [Trade2006ChzService],
})
export class ChzModule {}
