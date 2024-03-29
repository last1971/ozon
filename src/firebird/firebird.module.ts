import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Options, SupportedCharacterSet } from 'node-firebird';
import { FirebirdPool } from 'ts-firebird';

export const FIREBIRD = 'FIREBIRD';

@Module({
    providers: [
        {
            provide: FIREBIRD,
            useFactory: async (configService: ConfigService) => {
                const host = configService.get<string>('FB_HOST');
                if (!host) return null;
                const options: Options = {
                    host,
                    port: configService.get<number>('FB_PORT', 3050),
                    database: configService.get<string>('FB_BASE', '/var/lib/firebird/2.5/data/base.fdb'),
                    user: configService.get<string>('FB_USER', 'SYSDBA'),
                    password: configService.get<string>('FB_PASS', '123456'),
                    encoding: configService.get<SupportedCharacterSet>('FB_ENCD', 'UTF8'),
                    retryConnectionInterval: 1000, // reconnect interval in case of connection drop
                };
                return new FirebirdPool(configService.get<number>('FB_MAX_POOL', 5), options);
            },
            inject: [ConfigService],
        },
    ],
    exports: [FIREBIRD],
})
export class FirebirdModule {}
