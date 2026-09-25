import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { DonorTransferError, DonorTransferService } from './donor-transfer.service';
import { validatePicks } from './donor-picks.validator';
import { DonorMovedDto, FboShortageApplyDto, FboShortageApplyResultDto } from './dto/fbo-shortage-apply.dto';

/**
 * Ручной разбор недобора FBO: человек выбрал, с каких доноров сколько взять, — переносим той же
 * точкой, что автоматика (DonorTransferService), закрываем журнал FBO_SHORTAGE и отдаём счёт
 * в подбор, как делает автоматика после переезда. Всё в одной транзакции, всё или ничего:
 * предложение перечитывается внутри транзакции (свежие остатки), выбор проверяется validatePicks,
 * любой сбой переноса — откат целиком с текстом, что именно не прошло.
 */
@Injectable()
export class DonorApplyService {
    private readonly logger = new Logger(DonorApplyService.name);

    constructor(
        @Inject(INVOICE_SERVICE) private readonly invoiceService: IInvoice,
        private readonly transfer: DonorTransferService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async apply(posting: string, body: FboShortageApplyDto): Promise<FboShortageApplyResultDto> {
        const t = await this.invoiceService.getTransaction();
        try {
            const offer = (await this.invoiceService.findDonorsByPrim(posting, t)).find((o) => o.scode === Number(body.scode));
            if (!offer) throw new NotFoundException(`счёт ${body.scode} по отправлению ${posting} не найден`);

            const { errors, plan } = validatePicks(offer, body.picks, body.nominals ?? {});
            if (errors.length) throw new BadRequestException(errors.join('; '));

            // Фантомный резерв приёмника со свободного остатка — снять, как автоматика перед переносом.
            await this.invoiceService.clearInvoiceReserve(offer.scode, t);

            const moved: DonorMovedDto[] = [];
            const perGood = new Map<string, number>();
            for (const item of plan) {
                let result;
                try {
                    result = await this.transfer.transfer(
                        item.donor,
                        item.quantity,
                        { scode: offer.scode, realpricecode: item.realpricecode, goodscode: item.goodscode, nominal: item.nominal, posting },
                        t,
                    );
                } catch (e) {
                    if (e instanceof DonorTransferError) {
                        throw new BadRequestException(`счёт №${item.donor.invoiceNumber}: перенос не прошёл — ${e.message}`);
                    }
                    throw e;
                }
                // Застрявший код уменьшил перенос — недобор остался бы; ручной режим так не закрывает.
                if (result.moved !== item.quantity) {
                    throw new BadRequestException(
                        `счёт №${item.donor.invoiceNumber}: переехало ${result.moved} из ${item.quantity} (кодов застряло ${result.stuck}) — повторите выбор`,
                    );
                }
                moved.push({
                    realpricecode: item.realpricecode,
                    goodscode: item.goodscode,
                    donorInvoiceNumber: item.donor.invoiceNumber,
                    quantity: result.moved,
                    codes: result.codes,
                });
                perGood.set(item.goodscode, (perGood.get(item.goodscode) ?? 0) + result.moved);
            }

            for (const [goodscode, quantity] of perGood) {
                await this.invoiceService.closeFboShortage(posting, goodscode, quantity, t);
            }
            const shortageClosed = !(await this.invoiceService.isInFboShortage(posting, t));
            let pickedUp = false;
            if (shortageClosed) {
                const invoice = (await this.invoiceService.getPrimContaining(posting, t)).find((i) => i.id === offer.scode);
                if (invoice) {
                    await this.invoiceService.pickupFboUnlessShortage(invoice, t);
                    pickedUp = true;
                }
            }
            await t.commit(true);

            const summary = moved.map((m) => `${m.goodscode} × ${m.quantity} со счёта №${m.donorInvoiceNumber}`).join('; ');
            this.logger.log(`[donor-apply] ${posting} SCODE ${offer.scode}: ${summary}; журнал ${shortageClosed ? 'закрыт' : 'не закрыт'}`);
            this.eventEmitter.emit(
                'error.message',
                'FBO: недобор закрыт руками',
                `Заказ: ${posting}\nСчёт: №${offer.invoiceNumber}\nПереехало: ${summary}\n` +
                    (shortageClosed ? 'Недобора не осталось, счёт отдан в подбор.' : 'По другим позициям недобор ещё открыт.'),
            );
            return { posting, scode: offer.scode, moved, shortageClosed, pickedUp };
        } catch (e) {
            await t.rollback(true);
            throw e;
        }
    }
}
