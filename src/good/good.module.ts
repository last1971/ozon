import { Module } from '@nestjs/common';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
import { FirebirdDatabase } from 'ts-firebird';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';
import { GoodController } from './good.controller';

@Module({
    imports: [FirebirdModule],
    providers: [
        {
            provide: GOOD_SERVICE,
            useFactory: (dataBase: FirebirdDatabase) => new Trade2006GoodService(dataBase),
            inject: [FIREBIRD],
        },
    ],
    exports: [GOOD_SERVICE],
    controllers: [GoodController],
})
export class GoodModule {}
