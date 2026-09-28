import { Injectable } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { INotifyTransport, NotifyMessage } from './notify.types';

/** Почта как была: те же hbs-шаблоны и SMTP, только адрес приходит из маршрута, а не из env. */
@Injectable()
export class MailTransport implements INotifyTransport {
    readonly channel = 'mail' as const;

    constructor(private readonly mailService: MailService) {}

    async send(target: string, message: NotifyMessage): Promise<boolean> {
        return this.mailService.send({
            to: target,
            subject: message.subject,
            template: message.mail?.template ?? 'error_message',
            context: message.mail?.context ?? { message: message.text },
        });
    }
}
