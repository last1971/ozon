import { Injectable, Logger } from '@nestjs/common';
import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PostingDto } from '../posting/dto/posting.dto';
import { Cron } from '@nestjs/schedule';

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

    @Cron('0 0 9-19 * * 1-6', { name: 'checkHealth' })
    async checkHealth(): Promise<boolean> {
        return this.send({
            to: this.configService.get<string>('MAIL_LAST'),
            subject: 'Синхронизация с маркетплейсами',
            template: 'tick_message',
        });
    }

    @OnEvent('wb.order.content', { async: true })
    async wbOrders(subject: string, orders: any[]): Promise<boolean> {
        return this.send({
            to: this.configService.get<string>('MAIL_LAST'),
            subject,
            template: 'wb_order_content', // `.hbs` extension is appended automatically
            context: { orders },
        });
    }

    @OnEvent('error.message', { async: true })
    async errorMessage(subject: string, message: string): Promise<boolean> {
        return this.send({
            to: this.configService.get<string>('MAIL_LAST'),
            subject,
            template: 'error_message', // `.hbs` extension is appended automatically
            context: { message },
        });
    }
}
