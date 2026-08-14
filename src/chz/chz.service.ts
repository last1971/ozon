import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { writeRows } from '../helpers/spreadsheet.util';
import { ChzBatchInfo, ChzBatchKind, ChzPendingCode, Trade2006ChzService } from '../trade2006.chz/trade2006.chz.service';

/**
 * Передача кодов в ЧЗ (вкладка «ЧЗ» в админке + суточная напоминалка).
 *
 * Состояние живёт в базе (Trade2006ChzService — единственная точка правды),
 * здесь только оркестровка: снимок-пачка при скачивании, xlsx для ГИС МТ,
 * подтверждение кликом, напоминалка утром. Файл собирается из СОХРАНЁННОЙ
 * пачки, а не из живого состояния — подтверждается ровно то, что скачано.
 */
@Injectable()
export class ChzService {
    private readonly logger = new Logger(ChzService.name);

    constructor(
        private chzDb: Trade2006ChzService,
        private eventEmitter: EventEmitter2,
    ) {}

    async pending(): Promise<{ retire: ChzPendingCode[]; giveBack: ChzPendingCode[] }> {
        return {
            retire: await this.chzDb.pending('retire'),
            giveBack: await this.chzDb.pending('return'),
        };
    }

    /** Снимок текущего состояния в пачку. Пусто — null, пачка не плодится. */
    async createBatch(kind: ChzBatchKind): Promise<{ id: number; cnt: number } | null> {
        const batch = await this.chzDb.createBatch(kind);
        if (!batch) return null;
        this.logger.log(`ЧЗ: пачка №${batch.id} (${kind}) на ${batch.codes.length} КИ`);
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
        const name = batch.info.kind === 'retire' ? 'vyvod_iz_oborota' : 'vozvrat_v_oborot';
        return { filename: `${name}_${id}.xlsx`, content };
    }

    async confirmBatch(id: number): Promise<{ confirmed: number; skipped: number; already: boolean } | null> {
        const result = await this.chzDb.confirmBatch(id);
        if (result && !result.already) {
            this.logger.log(`ЧЗ: пачка №${id} подтверждена — ${result.confirmed} КИ, пропущено ${result.skipped}`);
        }
        return result;
    }

    async history(): Promise<ChzBatchInfo[]> {
        return this.chzDb.listBatches();
    }

    /**
     * Утренняя напоминалка: сколько кодов ждёт передачи в ЧЗ. Пусто — молчим.
     * Файлов в письме нет: свежая пачка скачивается из админки, только там
     * работает подтверждение. Время боевое задаёт cron.setup.ts (chzReminder).
     */
    @Cron('0 30 7 * * *', { name: 'chzReminder' })
    async reminder(): Promise<void> {
        const { retire, giveBack } = await this.pending();
        if (!retire.length && !giveBack.length) return;
        const lines = [
            'Коды ЧЗ ждут передачи — админка, вкладка «ЧЗ»: скачать файл, выгрузить в ГИС МТ, нажать «Подтвердить».',
            '',
            ...(retire.length ? [`Вывести из оборота: ${retire.length} КИ (продажи).`] : []),
            ...(giveBack.length ? [`Вернуть в оборот: ${giveBack.length} КИ (возвраты).`] : []),
        ];
        this.eventEmitter.emit('error.message', `ЧЗ: ждёт передачи ${retire.length + giveBack.length} КИ`, lines.join('\n'));
    }
}
