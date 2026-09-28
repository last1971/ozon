import { Module } from '@nestjs/common';
import { FirebirdModule } from '../firebird/firebird.module';
import { MailModule } from '../mail/mail.module';
import { MailTransport } from './mail.transport';
import { MatrixTransport } from './matrix.transport';
import { NotifierService } from './notifier.service';
import { NotifyRetryService } from './notify-retry.service';
import { NotifyRouteRepository } from './notify-route.repository';
import { NOTIFY_TRANSPORTS } from './notify.types';

@Module({
    imports: [FirebirdModule, MailModule],
    providers: [
        NotifyRouteRepository,
        MailTransport,
        MatrixTransport,
        NotifyRetryService,
        {
            provide: NOTIFY_TRANSPORTS,
            useFactory: (mail: MailTransport, matrix: MatrixTransport) => [mail, matrix],
            inject: [MailTransport, MatrixTransport],
        },
        NotifierService,
    ],
    exports: [NotifierService, NotifyRouteRepository],
})
export class NotifyModule {}
