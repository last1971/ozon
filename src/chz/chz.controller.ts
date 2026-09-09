import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { ChzService } from './chz.service';
import { ChzBatchKind } from '../trade2006.chz/trade2006.chz.service';
import { isChzAutoRetire } from '../helpers/mark-codes.helper';

@Controller('chz')
export class ChzController {
    constructor(
        private chzService: ChzService,
        private configService: ConfigService,
    ) {}

    /** autoRetire говорит вкладке, показывать ли кнопки ручной выгрузки вывода. */
    @Get('pending')
    async pending() {
        return { ...(await this.chzService.pending()), autoRetire: isChzAutoRetire(this.configService) };
    }

    @Post('batch/upd/:sfcode')
    async createDocBatch(@Param('sfcode', ParseIntPipe) sfcode: number) {
        this.assertManualRetireAllowed();
        const batch = await this.chzService.createDocBatch(sfcode);
        if (!batch) throw new NotFoundException(`По УПД ${sfcode} выводить нечего`);
        return batch;
    }

    @Post('batch/:kind')
    async createBatch(@Param('kind') kind: string) {
        if (kind !== 'retire' && kind !== 'return') {
            throw new BadRequestException('kind должен быть retire или return');
        }
        if (kind === 'retire') this.assertManualRetireAllowed();
        const batch = await this.chzService.createBatch(kind as ChzBatchKind);
        if (!batch) throw new NotFoundException('Передавать нечего — список пуст');
        return batch;
    }

    @Get('batch/:id/file')
    async batchFile(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
        const file = await this.chzService.batchFile(id);
        if (!file) throw new NotFoundException(`Пачка ${id} не найдена`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${file.filename}`);
        res.send(file.content);
    }

    @Post('batch/:id/confirm')
    async confirmBatch(@Param('id', ParseIntPipe) id: number, @Body() body?: { docNumber?: string }) {
        const result = await this.chzService.confirmBatch(id, body?.docNumber?.trim() || null);
        if (!result) throw new NotFoundException(`Пачка ${id} не найдена`);
        return result;
    }

    @Get('batches')
    async batches() {
        return this.chzService.history();
    }

    /**
     * Ручная выгрузка вывода закрыта, когда его возит очередь: тот же счёт,
     * вывезенный и файлом, и документом очереди, — это двойной вывод в ЧЗ.
     * Возврат в оборот флаг не трогает: он пока только ручной.
     */
    private assertManualRetireAllowed(): void {
        if (isChzAutoRetire(this.configService)) {
            throw new BadRequestException(
                'Вывод из оборота отправляет очередь (chz:outbox) — выгрузка файлом выключена. ' +
                    'Что уехало и что отбито, видно на странице «Отправка в Честный знак»',
            );
        }
    }
}
