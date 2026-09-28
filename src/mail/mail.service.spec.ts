import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import { MailerService } from '@nestjs-modules/mailer';

describe('MailService', () => {
    let service: MailService;
    const mailer = { sendMail: jest.fn() };

    beforeEach(async () => {
        mailer.sendMail.mockReset();
        const module: TestingModule = await Test.createTestingModule({
            providers: [MailService, { provide: MailerService, useValue: mailer }],
        }).compile();
        service = module.get<MailService>(MailService);
    });

    it('шлёт письмо с serverName в контексте', async () => {
        mailer.sendMail.mockResolvedValue(undefined);
        await expect(
            service.send({ to: 'a@b.c', subject: 's', template: 'error_message', context: { message: 'm' } }),
        ).resolves.toBe(true);
        expect(mailer.sendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'a@b.c',
                context: expect.objectContaining({ message: 'm', serverName: expect.any(String) }),
            }),
        );
    });

    it('ошибка SMTP → false, не исключение', async () => {
        mailer.sendMail.mockRejectedValue(new Error('smtp down'));
        await expect(service.send({ to: 'a@b.c', subject: 's' })).resolves.toBe(false);
    });
});
