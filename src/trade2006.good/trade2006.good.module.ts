import { Module } from '@nestjs/common';
import { Trade2006GoodService } from './trade2006.good.service';
import { FirebirdModule } from '../firebird/firebird.module';

@Module({
    imports: [FirebirdModule],
    providers: [Trade2006GoodService],
})
export class Trade2006GoodModule {}
