import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { writeRows } from '../helpers/spreadsheet.util';
import { NotifyTopic } from '../notify/notify.types';
import { isChzAutoRetire } from '../helpers/mark-codes.helper';
import {
    ChzBatchInfo,
    ChzBatchKind,
    ChzPendingCode,
    ChzPendingDoc,
    Trade2006ChzService,
} from '../trade2006.chz/trade2006.chz.service';

/**
 * Передача кодов в ЧЗ (вкладка «ЧЗ» в админке + суточная напоминалка).
 *
 * Состояние живёт в базе (Trade2006ChzService — единственная точка правды),
 * здесь только оркестровка: снимок-пачка при скачивании, xlsx для ГИС МТ,
 * подтверждение кликом, напоминалка утром. Файл собирается из СОХРАНЁННОЙ
 * пачки, а не из живого состояния — подтверждается ровно то, что скачано.
 *
 * Видов вывода два: продажи маркетплейса (одной пачкой на все коды) и УПД
 * покупателю вне ЧЗ (пачка на КАЖДЫЙ документ — в ГИС МТ вывод оформляется
 * по документу, там нужны его номер и дата).
 */
@Injectable()
export class ChzService {
    private readonly logger = new Logger(ChzService.name);

    constructor(
        private chzDb: Trade2006ChzService,
        private eventEmitter: EventEmitter2,
        private configService: ConfigService,
    ) {}

    async pending(): Promise<{ retire: ChzPendingCode[]; giveBack: ChzPendingCode[]; upd: ChzPendingDoc[] }> {
        return {
            retire: await this.chzDb.pending('retire'),
            giveBack: await this.chzDb.pending('return'),
            upd: await this.chzDb.pendingDocs(),
        };
    }

    /** Снимок текущего состояния в пачку. Пусто — null, пачка не плодится. */
    async createBatch(kind: ChzBatchKind): Promise<{ id: number; cnt: number } | null> {
        const batch = await this.chzDb.createBatch(kind);
        if (!batch) return null;
        this.logger.log(`ЧЗ: пачка №${batch.id} (${kind}) на ${batch.codes.length} КИ`);
        return { id: batch.id, cnt: batch.codes.length };
    }

    /** Пачка по одной УПД. */
    async createDocBatch(sfcode: number): Promise<{ id: number; cnt: number } | null> {
        const batch = await this.chzDb.createDocBatch(sfcode);
        if (!batch) return null;
        this.logger.log(`ЧЗ: пачка №${batch.id} по УПД ${sfcode} на ${batch.codes.length} КИ`);
        return { id: batch.id, cnt: batch.codes.length };
    }

    /**
     * xlsx пачки в формате ГИС МТ: КИ + цена строкой «1234.00», БЕЗ заголовка
     * (выверено живыми загрузками 14.08 — заголовок ГИС МТ принимает за код).
     */
    async batchFile(id: number): Promise<{ filename: string; content: Buffer } | null> {
        const batch = await this.chzDb.getBatch(id);
        if (!batch) return null;
        const content = await writeRows(
            batch.codes.map((code) => [code.ki, code.price === null ? '' : code.price.toFixed(2)]),
        );
        return { filename: this.fileName(batch.info), content };
    }

    /**
     * Имя файла. У пачки по УПД в имени номер и дата документа — по ним
     * владелец заполняет форму вывода в ГИС МТ и не путает файлы между собой.
     */
    private fileName(info: ChzBatchInfo): string {
        if (info.kind === 'return') return `vozvrat_v_oborot_${info.id}.xlsx`;
        if (info.kind !== 'retire_upd') return `vyvod_iz_oborota_${info.id}.xlsx`;
        const nsf = info.nsf ?? info.sfcode ?? info.id;
        const date = info.date ? new Date(info.date).toLocaleDateString('ru-RU') : '';
        return `vyvod_UPD-${nsf}${date ? `_${date}` : ''}.xlsx`;
    }

    async confirmBatch(
        id: number,
        docNumber: string | null = null,
    ): Promise<{ confirmed: number; skipped: number; already: boolean } | null> {
        const result = await this.chzDb.confirmBatch(id, docNumber);
        if (result && !result.already) {
            this.logger.log(`ЧЗ: пачка №${id} подтверждена — ${result.confirmed} КИ, пропущено ${result.skipped}`);
        }
        return result;
    }

    async history(): Promise<ChzBatchInfo[]> {
        return this.chzDb.listBatches();
    }

    /**
     * Утренняя напоминалка: сколько кодов ждёт вывода и возврата и по скольким
     * счетам. Одно письмо на базу, пусто — молчим. Отправляет очередь Trade —
     * письмо только сообщает, сколько осталось; при ручной выгрузке подсказывает,
     * что делать. Время боевое задаёт cron.setup.ts (chzReminder).
     */
    @Cron('0 30 7 * * *', { name: 'chzReminder' })
    async reminder(): Promise<void> {
        const { retire, giveBack, upd } = await this.pending();
        const letter = ChzService.reminderLetter(retire, giveBack, upd, isChzAutoRetire(this.configService));
        if (letter) this.eventEmitter.emit('error.message', letter.subject, letter.body, NotifyTopic.MARKING);
    }

    /** Текст напоминалки. Чистая функция ради теста; null — писать нечего. */
    static reminderLetter(
        retire: ChzPendingCode[],
        giveBack: ChzPendingCode[],
        upd: ChzPendingDoc[],
        autoRetire: boolean,
    ): { subject: string; body: string } | null {
        const updCodes = upd.reduce((sum, doc) => sum + doc.cnt, 0);
        if (!retire.length && !giveBack.length && !updCodes) return null;

        const subject = [
            ...(retire.length || updCodes ? [`ждут вывода ${retire.length + updCodes} КИ`] : []),
            ...(giveBack.length ? [`возврата ${giveBack.length} КИ`] : []),
        ].join(', ');
        const lines = [
            ...(retire.length ? [`Вывести из оборота: ${retire.length} КИ, ${ChzService.invoices(retire)}.`] : []),
            ...(updCodes ? [`Вывести по УПД: ${updCodes} КИ, документов ${upd.length}.`] : []),
            ...(giveBack.length ? [`Вернуть в оборот: ${giveBack.length} КИ, ${ChzService.invoices(giveBack)}.`] : []),
            '',
            autoRetire
                ? 'Отправляет очередь Trade — страница «Отправка в Честный знак».'
                : 'Админка, вкладка «ЧЗ»: скачать файл, выгрузить в ГИС МТ, нажать «Подтвердить».',
        ];
        return { subject: `ЧЗ: ${subject}`, body: lines.join('\n') };
    }

    /** «счетов N» и, если есть коды без счёта, «без счёта M». */
    private static invoices(codes: ChzPendingCode[]): string {
        const numbers = new Set(codes.filter((c) => c.invoiceNumber !== null).map((c) => c.invoiceNumber));
        const loose = codes.filter((c) => c.invoiceNumber === null).length;
        return `счетов ${numbers.size}` + (loose ? `, без счёта ${loose}` : '');
    }
}
