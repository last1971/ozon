import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Firebird from 'node-firebird';
import { FirebirdDatabase } from 'ts-firebird';

export const FIREBIRD = 'FIREBIRD';

@Module({
    providers: [
        {
            provide: FIREBIRD,
            useFactory: async (configService: ConfigService) => {
                const host = configService.get<string>('FB_HOST');
                if (!host) return null;
                const options: Firebird.Options = {
                    host,
                    port: 3050,
                    database: configService.get<string>('FB_BASE', '/var/lib/firebird/2.5/data/base.fdb'),
                    user: 'SYSDBA',
                    password: '641767',
                    encoding: 'UTF8',
                };
                return FirebirdDatabase.buildAndAttach(options);
            },
            inject: [ConfigService],
        },
    ],
    exports: [FIREBIRD],
})
export class FirebirdModule {}
