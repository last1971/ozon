import { BadRequestException, ConflictException } from '@nestjs/common';
import { MpReturnService } from './mp-return.service';
import { ReturnRefusedError } from './return-refused.error';

const line = {
    service: 'OZON',
    extId: '1',
    posting: 'P-1',
    offerId: '538612',
    units: 1,
    reason: 'r',
    productName: 'x',
};

function setup(chainResult: () => Promise<any>) {
    const t = { commit: jest.fn(), rollback: jest.fn(async () => undefined) };
    const source = { service: 'OZON', find: jest.fn(async () => [line]), listReceived: jest.fn() };
    const factory = { forAction: jest.fn(() => ({ execute: jest.fn(chainResult) })), writeOff: jest.fn() };
    const emit = jest.fn();
    const service = new MpReturnService(
        [source as any],
        { getTransaction: async () => t } as any,
        {} as any,
        {} as any,
        {} as any,
        factory as any,
        { emit } as any,
    );
    return { service, t, emit, factory };
}

const dto = { action: 'return-writeoff' as const, username: 'Кладовщик', osnSpisId: 4, extIds: ['1'] };

describe('MpReturnService.accept — одна транзакция на кнопку', () => {
    it('успех: commit, уведомление после commit', async () => {
        const { service, t, emit } = setup(async () => ({
            action: 'return',
            line,
            username: 'Кладовщик',
            card: { quan: 1, invoice: { number: 20008 }, invoiceLine: { name: 'NUCLEO' } },
            retiredKis: [],
            writeOff: { spisCode: 5 },
        }));
        const res = await service.accept('OZON', dto);
        expect(t.commit).toHaveBeenCalled();
        expect(t.rollback).not.toHaveBeenCalled();
        expect(res.message).toContain('документ 5');
        expect(emit).toHaveBeenCalledWith(
            'error.message',
            'Принят возврат',
            expect.stringContaining('Списан: документ 5'),
            'OPS',
        );
    });

    it('отказ списания в «вернуть и списать» откатывает и приём, кладовщику 400 с текстом', async () => {
        const { service, t, emit } = setup(async () => {
            throw new ReturnRefusedError('Товар в резерве под счёт 20849');
        });
        await expect(service.accept('OZON', dto)).rejects.toThrow(BadRequestException);
        expect(t.rollback).toHaveBeenCalled();
        expect(t.commit).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('сбой процедуры посреди цепочки — откат и исходная ошибка', async () => {
        const { service, t } = setup(async () => {
            throw new Error('Нельзя расформировать отгруженный товар');
        });
        await expect(service.accept('OZON', dto)).rejects.toThrow('Нельзя расформировать');
        expect(t.rollback).toHaveBeenCalled();
    });

    it('блокировка кроном — 409 «повторите через минуту»', async () => {
        const { service } = setup(async () => {
            throw new Error('lock conflict on no wait transaction');
        });
        await expect(service.accept('OZON', dto)).rejects.toThrow(ConflictException);
    });

    it('неподдержанный маркетплейс — 400', async () => {
        const { service } = setup(async () => ({}));
        await expect(service.accept('WB', dto)).rejects.toThrow('пока не поддержаны');
    });
});

describe('MpReturnService.accept — вся посылка одной кнопкой', () => {
    const lineOf = (extId: string) => ({ ...line, extId });
    const done = (ctx: any) => ({
        ...ctx,
        card: { quan: 1, invoice: { number: 18948 }, invoiceLine: { name: 'SSR-40AA-H' } },
        retiredKis: [],
    });
    function group(chain: (ctx: any) => Promise<any>) {
        const t = { commit: jest.fn(), rollback: jest.fn(async () => undefined) };
        const lines = ['1', '2', '3'].map(lineOf);
        const source = {
            service: 'OZON',
            find: jest.fn(async (q: any) => (q.kind === 'posting' ? lines : [])),
            listReceived: jest.fn(),
        };
        const execute = jest.fn(chain);
        const emit = jest.fn();
        const service = new MpReturnService(
            [source as any],
            { getTransaction: async () => t } as any,
            {} as any,
            {} as any,
            {} as any,
            { forAction: () => ({ execute }) } as any,
            { emit } as any,
        );
        return { service, t, emit, execute, source };
    }
    const body = { action: 'return' as const, username: 'Кладовщик', extIds: ['1', '2', '3'], posting: 'P-1' };

    it('цепочка по каждому возврату в одной транзакции, одно уведомление на кнопку', async () => {
        const { service, t, emit, execute, source } = group(async (ctx) => done(ctx));
        const res = await service.accept('OZON', body);
        expect(execute).toHaveBeenCalledTimes(3);
        expect(new Set(execute.mock.calls.map(([c]) => c.t)).size).toBe(1);
        expect(new Set(execute.mock.calls.map(([c]) => c.marks)).size).toBe(1);
        expect(source.find).toHaveBeenCalledTimes(1);
        expect(t.commit).toHaveBeenCalledTimes(1);
        expect(res.message).toBe('Принято 3 шт (возвратов 3), счёт №18948');
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][2]).toBe('P-1: счёт №18948, SSR-40AA-H — 3 шт (возвратов 3), принял Кладовщик');
    });

    it('отказ по одному возврату откатывает все и называет его', async () => {
        const { service, t, emit } = group(async (ctx) => {
            if (ctx.line.extId === '2') throw new ReturnRefusedError('Возврат уже принят');
            return done(ctx);
        });
        await expect(service.accept('OZON', body)).rejects.toThrow('Возврат 2 (538612): Возврат уже принят');
        expect(t.rollback).toHaveBeenCalled();
        expect(t.commit).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('лишние марки после всех возвратов — откат', async () => {
        const { service, t } = group(async (ctx) => {
            ctx.marks.take([{ ki: '0104650194492385215gpBxjCjAX001', quantity: 1 }], 0);
            return done(ctx);
        });
        await expect(service.accept('OZON', { ...body, scans: ['0104650194492385215gpBxjCjAX001'] })).rejects.toThrow(
            'Лишние марки',
        );
        expect(t.rollback).toHaveBeenCalled();
    });

    it('неизвестный возврат — 404 до транзакции', async () => {
        const { service, execute } = group(async (ctx) => done(ctx));
        await expect(service.accept('OZON', { ...body, extIds: ['1', '99'] })).rejects.toThrow('Возврат 99 не найден');
        expect(execute).not.toHaveBeenCalled();
    });
});
