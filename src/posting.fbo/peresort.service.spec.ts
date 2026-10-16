import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { PeresortService } from './peresort.service';
import { LoadShortageLineCommand } from './peresort/load-shortage-line.command';
import { AssertNotMarkedCommand } from './peresort/assert-not-marked.command';
import { BuildPeresortDocCommand } from './peresort/build-peresort-doc.command';
import { PickupLineCommand } from './peresort/pickup-line.command';
import { CloseShortageCommand } from './peresort/close-shortage.command';
import { AllocateSpisCodeCommand } from '../helpers/spis/allocate-spis-code.command';
import { CreateSpisDocCommand } from '../helpers/spis/create-spis-doc.command';

const step = (name: string, patch: object = {}, fail?: Error) => ({
    execute: jest.fn(async (ctx: any) => {
        if (fail) throw fail;
        return { ...ctx, ...patch, trace: [...(ctx.trace ?? []), name] };
    }),
});

type Steps = 'load' | 'notMarked' | 'buildDoc' | 'allocate' | 'createDoc' | 'pickup' | 'close';

describe('PeresortService', () => {
    const commit = jest.fn();
    const rollback = jest.fn();
    const t = { commit, rollback };
    const emit = jest.fn();
    const line = { goodscode: '557614', name: 'ECAP', realpricecode: 900 };

    const build = async (over: Partial<Record<Steps, any>> = {}) => {
        const cmds = {
            load: over.load ?? step('load', { line, quantity: 1 }),
            notMarked: over.notMarked ?? step('notMarked'),
            buildDoc: over.buildDoc ?? step('buildDoc', { spis: {} }),
            allocate: over.allocate ?? step('allocate', { spisCode: 9720 }),
            createDoc: over.createDoc ?? step('createDoc'),
            pickup: over.pickup ?? step('pickup'),
            close: over.close ?? step('close', { shortageClosed: true, pickedUp: true }),
        };
        const module = await Test.createTestingModule({
            providers: [
                PeresortService,
                { provide: INVOICE_SERVICE, useValue: { getTransaction: jest.fn().mockResolvedValue(t) } },
                { provide: LoadShortageLineCommand, useValue: cmds.load },
                { provide: AssertNotMarkedCommand, useValue: cmds.notMarked },
                { provide: BuildPeresortDocCommand, useValue: cmds.buildDoc },
                { provide: AllocateSpisCodeCommand, useValue: cmds.allocate },
                { provide: CreateSpisDocCommand, useValue: cmds.createDoc },
                { provide: PickupLineCommand, useValue: cmds.pickup },
                { provide: CloseShortageCommand, useValue: cmds.close },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        return { service: module.get(PeresortService), cmds };
    };

    beforeEach(() => {
        [commit, rollback, emit].forEach((m) => m.mockReset());
        rollback.mockResolvedValue(undefined); // обёртка делает rollback().catch()
    });

    it('порядок: строка → не маркируемый → документ → номер → запись → подбор → закрыть недобор; commit, письмо, ответ', async () => {
        const { service, cmds } = await build();
        const res = await service.apply('P-1', { scode: 500, realpricecode: 900, username: ' Ластовка ' });
        const last = cmds.close.execute.mock.calls[0][0];
        expect(last.trace).toEqual(['load', 'notMarked', 'buildDoc', 'allocate', 'createDoc', 'pickup']);
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
        expect(cmds.createDoc.execute).not.toHaveBeenCalled();
        expect(rollback).toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });
});
