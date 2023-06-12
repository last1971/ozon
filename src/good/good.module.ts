import { Module } from '@nestjs/common';
import { FIREBIRD, FirebirdModule } from '../firebird/firebird.module';
import { ConfigService } from '@nestjs/config';
import { FirebirdDatabase } from 'ts-firebird';
import { GOOD_SERVICE } from '../interfaces/IGood';
import { Trade2006GoodService } from '../trade2006.good/trade2006.good.service';

@Module({
    imports: [FirebirdModule],
    providers: [
        {
            provide: GOOD_SERVICE,
            useFactory: (configService: ConfigService, dataBase: FirebirdDatabase) =>
                new Trade2006GoodService(dataBase, configService),
            inject: [ConfigService, FIREBIRD],
        },
    ],
    exports: [GOOD_SERVICE],
})
export class GoodModule {}
