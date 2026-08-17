import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { ChzService } from './chz.service';
import { ChzBatchKind } from '../trade2006.chz/trade2006.chz.service';

@Controller('chz')
export class ChzController {
    constructor(private chzService: ChzService) {}

    @Get('pending')
    async pending() {
        return this.chzService.pending();
    }

    @Post('batch/upd/:sfcode')
    async createDocBatch(@Param('sfcode', ParseIntPipe) sfcode: number) {
        const batch = await this.chzService.createDocBatch(sfcode);
        if (!batch) throw new NotFoundException(`По УПД ${sfcode} выводить нечего`);
        return batch;
    }

    @Post('batch/:kind')
    async createBatch(@Param('kind') kind: string) {
        if (kind !== 'retire' && kind !== 'return') {
            throw new BadRequestException('kind должен быть retire или return');
        }
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
}
