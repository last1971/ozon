import { Module } from '@nestjs/common';
import { Trade2006IncomingService } from './trade2006.incoming.service';
import { FirebirdModule } from '../firebird/firebird.module';
import { Trade2006IncomingController } from "./trade2006.incoming.controller";

@Module({
  imports: [FirebirdModule],
  providers: [Trade2006IncomingService],
  exports: [Trade2006IncomingService],
  controllers: [Trade2006IncomingController],
})
export class Trade2006IncomingModule {}