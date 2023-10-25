import { Injectable, Logger } from '@nestjs/common';
import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PostingDto } from '../posting/dto/posting.dto';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    constructor(
        private readonly mailerService: MailerService,
        private configService: ConfigService,
    ) {}

    private async send(options: ISendMailOptions): Promise<boolean> {
        try {
            await this.mailerService.sendMail(options);
            return true;
        } catch (e) {
            this.logger.error(e.message);
            return false;
        }
    }

    @OnEvent('wb.order.created', { async: true })
    async wbOrderCreated(posting: PostingDto): Promise<boolean> {
        return this.send({
            to: await this.configService.get<string>('MAIL_ADMIN'),
            subject: 'Вайлдберриз порадовал заказом',
            template: 'wb_order_message', // `.hbs` extension is appended automatically
            context: posting,
        });
    }
}
