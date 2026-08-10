import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { IInvoice, INVOICE_SERVICE } from '../interfaces/IInvoice';
import { isMarkCodesEnabled } from '../helpers/mark-codes.helper';

/**
 * Еженедельный отчёт «подвисшие коды» (Этап 5, перенесён в итерацию 5).
 *
 * Подвисший — это код, ушедший маркетплейсу (TT=2 или TT=3) и оставшийся
 * в обороте (STATUS=5) на счёте, который уже не в работе: продажа состоялась,
 * а из оборота код не вывели. Эталонный случай — §3 плана: FBS-заказ отменён
 * после отгрузки, счёт стал донором, код уехал на FBO-продажу и вывести его
 * не может никто.
 *
 * Почему отчёт нужен раньше остального ручного контура: письма дедуплицируются
 * «одно на состояние», то есть про зависший код система напоминает ровно один
 * раз и больше никогда. Этот отчёт — единственное, что ловит накопленную
 * погрешность, и на него прямо опирается решение Этапа 0.2.
 */
@Injectable()
export class StuckCodesService {
    private readonly logger = new Logger(StuckCodesService.name);
    /** Свежий код на счёте в работе — норма. Висяком считаем то, что лежит дольше. */
    private static readonly MIN_AGE_DAYS = 3;
    /** В письмо больше не влезает по-человечески; сколько осталось — пишем строкой. */
    private static readonly LETTER_LIMIT = 200;

    constructor(
        @Inject(INVOICE_SERVICE) private invoiceService: IInvoice,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
    ) {}

    @Cron('0 0 8 * * 1', { name: 'weeklyStuckCodes' })
    async report(): Promise<void> {
        // На магазине маркировка выключена, таблицы MARKCODES там нет вовсе.
        if (!isMarkCodesEnabled(this.configService)) return;

        let rows: Awaited<ReturnType<IInvoice['findStuckMarkCodes']>>;
        try {
            rows = await this.invoiceService.findStuckMarkCodes(StuckCodesService.MIN_AGE_DAYS, null);
        } catch (e) {
            this.logger.error(`отчёт «подвисшие коды» не собран — ${e.message}`);
            this.eventEmitter.emit('error.message', 'Отчёт «подвисшие коды» не собран', e.message);
            return;
        }

        this.logger.log(`подвисших кодов: ${rows.length}`);
        if (!rows.length) return;

        const shown = rows.slice(0, StuckCodesService.LETTER_LIMIT);
        const lines = shown.map((row) => {
            const age = row.invoiceDate
                ? Math.floor(-DateTime.fromJSDate(new Date(row.invoiceDate)).diffNow('days').days)
                : null;
            return (
                `${row.ki} — товар ${row.goodscode}, TT=${row.transferType}, STATUS=${row.status}` +
                `, счёт ${row.scode ?? 'нет'}${row.prim ? ` «${row.prim.trim()}»` : ''}` +
                `${row.invoiceStatus === null ? '' : ` (S.STATUS=${row.invoiceStatus})`}` +
                `${age === null ? '' : `, возраст ${age} дн`}`
            );
        });
        if (rows.length > shown.length) {
            lines.push(`… и ещё ${rows.length - shown.length} кодов — полный список в базе, отчёт обрезан`);
        }

        this.eventEmitter.emit(
            'error.message',
            `Подвисшие коды: ${rows.length}`,
            [
                'Коды, ушедшие маркетплейсу (TT=2/3) и оставшиеся в обороте (STATUS=5)',
                `на счетах, которые уже не в работе. Старше ${StuckCodesService.MIN_AGE_DAYS} дн.`,
                '',
                ...lines,
            ].join('\n'),
        );
    }
}
