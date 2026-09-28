import { Injectable, Logger } from '@nestjs/common';
import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import { hostname } from 'os';

/**
 * Почтовый транспорт: hbs-шаблон + SMTP. Кому и что слать решает NotifierService
 * (src/notify) по таблице NOTIFY_ROUTE — здесь адресов и событий нет.
 */
@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    constructor(private readonly mailerService: MailerService) {}

    async send(options: ISendMailOptions): Promise<boolean> {
        try {
            await this.mailerService.sendMail({
                ...options,
                context: { ...options.context, serverName: hostname() },
            });
            return true;
        } catch (e) {
            this.logger.error(e.message);
            return false;
        }
    }
}
