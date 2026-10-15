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

const dto = { action: 'return-writeoff' as const, username: 'Кладовщик', osnSpisId: 4 };

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
        const res = await service.accept('OZON', '1', dto);
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
        await expect(service.accept('OZON', '1', dto)).rejects.toThrow(BadRequestException);
        expect(t.rollback).toHaveBeenCalled();
        expect(t.commit).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('сбой процедуры посреди цепочки — откат и исходная ошибка', async () => {
        const { service, t } = setup(async () => {
            throw new Error('Нельзя расформировать отгруженный товар');
        });
        await expect(service.accept('OZON', '1', dto)).rejects.toThrow('Нельзя расформировать');
        expect(t.rollback).toHaveBeenCalled();
    });

    it('блокировка кроном — 409 «повторите через минуту»', async () => {
        const { service } = setup(async () => {
            throw new Error('lock conflict on no wait transaction');
        });
        await expect(service.accept('OZON', '1', dto)).rejects.toThrow(ConflictException);
    });

    it('неподдержанный маркетплейс — 400', async () => {
        const { service } = setup(async () => ({}));
        await expect(service.accept('WB', '1', dto)).rejects.toThrow('пока не поддержаны');
    });
});
