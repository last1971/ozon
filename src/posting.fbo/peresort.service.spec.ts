import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { PeresortService } from './peresort.service';
import { LoadShortageLineCommand } from './peresort/load-shortage-line.command';
import { AssertNotMarkedCommand } from './peresort/assert-not-marked.command';
import { CreatePeresortDocCommand } from './peresort/create-peresort-doc.command';
import { PickupLineCommand } from './peresort/pickup-line.command';
import { CloseShortageCommand } from './peresort/close-shortage.command';

const step = (name: string, patch: object = {}, fail?: Error) => ({
    execute: jest.fn(async (ctx: any) => {
        if (fail) throw fail;
        return { ...ctx, ...patch, trace: [...(ctx.trace ?? []), name] };
    }),
});

describe('PeresortService', () => {
    const commit = jest.fn();
    const rollback = jest.fn();
    const t = { commit, rollback };
    const emit = jest.fn();
    const line = { goodscode: '557614', name: 'ECAP', realpricecode: 900 };

    const build = async (over: Partial<Record<'load' | 'notMarked' | 'doc' | 'pickup' | 'close', any>> = {}) => {
        const cmds = {
            load: over.load ?? step('load', { line, quantity: 1 }),
            notMarked: over.notMarked ?? step('notMarked'),
            doc: over.doc ?? step('doc', { spisCode: 9720 }),
            pickup: over.pickup ?? step('pickup'),
            close: over.close ?? step('close', { shortageClosed: true, pickedUp: true }),
        };
        const module = await Test.createTestingModule({
            providers: [
                PeresortService,
                { provide: INVOICE_SERVICE, useValue: { getTransaction: jest.fn().mockResolvedValue(t) } },
                { provide: LoadShortageLineCommand, useValue: cmds.load },
                { provide: AssertNotMarkedCommand, useValue: cmds.notMarked },
                { provide: CreatePeresortDocCommand, useValue: cmds.doc },
                { provide: PickupLineCommand, useValue: cmds.pickup },
                { provide: CloseShortageCommand, useValue: cmds.close },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        return { service: module.get(PeresortService), cmds };
    };

    beforeEach(() => [commit, rollback, emit].forEach((m) => m.mockReset()));

    it('порядок: строка → не маркируемый → пересортица → подбор → закрыть недобор; commit, письмо, ответ', async () => {
        const { service, cmds } = await build();
        const res = await service.apply('P-1', { scode: 500, realpricecode: 900, username: ' Ластовка ' });
        const last = cmds.close.execute.mock.calls[0][0];
        expect(last.trace).toEqual(['load', 'notMarked', 'doc', 'pickup']);
        expect(last.username).toBe('Ластовка');
        expect(commit).toHaveBeenCalled();
        expect(rollback).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith(
            'error.message',
            'FBO: недобор закрыт пересортицей',
            expect.stringContaining('ECAP × 1'),
            expect.anything(),
        );
        expect(res).toEqual({
            posting: 'P-1',
            scode: 500,
            realpricecode: 900,
            goodscode: '557614',
            quantity: 1,
            spisCode: 9720,
            shortageClosed: true,
            pickedUp: true,
        });
    });

    it('шаг отказал → rollback, ошибка наружу, письма нет', async () => {
        const { service, cmds } = await build({
            notMarked: step('notMarked', {}, new BadRequestException('маркируемый')),
        });
        await expect(service.apply('P-1', { scode: 500, realpricecode: 900, username: 'x' })).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(cmds.doc.execute).not.toHaveBeenCalled();
        expect(rollback).toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });
});
