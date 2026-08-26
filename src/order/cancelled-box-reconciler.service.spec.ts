import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CancelledBoxReconcilerService } from './cancelled-box-reconciler.service';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { PostingService } from '../posting/posting.service';

describe('CancelledBoxReconcilerService — суточная сверка «коробка уехала, а счёт помечен « отмена»»', () => {
    const findPlainCancelledInvoices = jest.fn();
    const listReturnsByPostings = jest.fn();
    const emit = jest.fn();
    let service: CancelledBoxReconcilerService;

    const invoice = {
        scode: 93651,
        number: 16713,
        prim: '01713732-0274-1 отмена',
        posting: '01713732-0274-1',
        status: 1,
        date: new Date('2026-08-26'),
    };

    const ozonReturn = {
        id: 1001459067,
        posting_number: '01713732-0274-1',
        schema: 'Fbs',
        type: 'Cancellation',
        visual: { status: { sys_name: 'MovingToOzon' } },
        place: { name: 'ТОМСК_70' },
        target_place: { name: 'НОВОСИБИРСК_РФЦ_НОВЫЙ_ВОЗВРАТЫ' },
    };

    const withState = (state: string, extra: Record<string, unknown> = {}) => ({
        ...ozonReturn,
        ...extra,
        visual: { status: { sys_name: state } },
    });

    const body = () => emit.mock.calls[0][2] as string;

    beforeEach(async () => {
        findPlainCancelledInvoices.mockReset().mockResolvedValue([invoice]);
        listReturnsByPostings.mockReset().mockResolvedValue([ozonReturn]);
        emit.mockReset();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CancelledBoxReconcilerService,
                { provide: INVOICE_SERVICE, useValue: { findPlainCancelledInvoices } },
                { provide: PostingService, useValue: { listReturnsByPostings } },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get(CancelledBoxReconcilerService);
    });

    describe('когда звать исправлять, а когда молчать', () => {
        it('коробка ЕЩЁ В ПУТИ → письмо есть, но менять пометку не зовёт', async () => {
            await service.report();

            expect(listReturnsByPostings).toHaveBeenCalledWith(['01713732-0274-1']);
            expect(emit).toHaveBeenCalledTimes(1);
            const [event, subject] = emit.mock.calls[0];
            expect(event).toBe('error.message');
            expect(subject).toContain(': 1');
            expect(body()).toContain('№16713');
            expect(body()).toContain('SCODE 93651');
            expect(body()).toContain('MovingToOzon');
            expect(body()).toContain('ТОМСК_70 → НОВОСИБИРСК_РФЦ_НОВЫЙ_ВОЗВРАТЫ');
            expect(body()).toContain('ЕЩЁ В ПУТИ');
            expect(body()).not.toContain('ДОЕХАЛО ДО СКЛАДА МАРКЕТПЛЕЙСА');
            expect(body()).not.toContain('заменить пометку');
        });

        it('коробка ДОЕХАЛА (ReturnedToOzon) → зовёт ставить « отмена FBO»', async () => {
            listReturnsByPostings.mockResolvedValue([withState('ReturnedToOzon')]);

            await service.report();

            expect(body()).toContain('ДОЕХАЛО ДО СКЛАДА МАРКЕТПЛЕЙСА');
            expect(body()).toContain('заменить пометку');
            expect(body()).toContain('отмена FBO');
            expect(body()).not.toContain('ЕЩЁ В ПУТИ');
        });

        it('раннее WaitingShipment → «в пути»: направление по имени состояния неизвестно', async () => {
            listReturnsByPostings.mockResolvedValue([withState('WaitingShipment')]);

            await service.report();

            expect(body()).toContain('ЕЩЁ В ПУТИ');
            expect(body()).not.toContain('заменить пометку');
        });

        it.each([['MovingToSeller'], ['ReceivedBySeller'], ['ArrivedAtReturnPlace']])(
            'возврат едет К НАМ (%s) → письма нет: пометка « отмена» для него верна',
            async (state) => {
                listReturnsByPostings.mockResolvedValue([withState(state)]);

                await service.report();

                expect(emit).not.toHaveBeenCalled();
            },
        );

        it.each([['Cancelled'], ['MoneyReturned'], ['Rejected']])(
            'заявочное состояние (%s) → письма нет: физики не было',
            async (state) => {
                listReturnsByPostings.mockResolvedValue([withState(state)]);

                await service.report();

                expect(emit).not.toHaveBeenCalled();
            },
        );

        it.each([['WriteOff'], ['Utilized'], ['PotentiallyLost']])(
            'товар потерян у маркетплейса (%s) → свой раздел, а не «ждите, доедет»',
            async (state) => {
                listReturnsByPostings.mockResolvedValue([withState(state)]);

                await service.report();

                expect(body()).toContain('ТОВАР НЕ ДОЕДЕТ');
                expect(body()).not.toContain('ЕЩЁ В ПУТИ');
                expect(body()).not.toContain('заменить пометку');
            },
        );

        it('возврата у маркетплейса нет → письма нет (коробка действительно у нас)', async () => {
            listReturnsByPostings.mockResolvedValue([]);

            await service.report();

            expect(emit).not.toHaveBeenCalled();
        });

        it('помеченных счетов нет → маркетплейс не спрашиваем вовсе', async () => {
            findPlainCancelledInvoices.mockResolvedValue([]);

            await service.report();

            expect(listReturnsByPostings).not.toHaveBeenCalled();
            expect(emit).not.toHaveBeenCalled();
        });

        it('возврат по чужому отправлению из общей выдачи в письмо не попадает', async () => {
            listReturnsByPostings.mockResolvedValue([{ ...ozonReturn, posting_number: 'ЧУЖОЕ-0001-1' }]);

            await service.report();

            expect(emit).not.toHaveBeenCalled();
        });
    });

    describe('фантомный остаток: счёт расформировали, а товар у маркетплейса', () => {
        it('расформированный счёт → отдельный раздел, а не «доехало»', async () => {
            findPlainCancelledInvoices.mockResolvedValue([{ ...invoice, status: 0 }]);
            listReturnsByPostings.mockResolvedValue([withState('ReturnedToOzon')]);

            await service.report();

            expect(body()).toContain('СЧЁТ УЖЕ РАСФОРМИРОВАН');
            expect(body()).toContain('фантомный остаток');
            expect(body()).not.toContain('ДОЕХАЛО ДО СКЛАДА МАРКЕТПЛЕЙСА');
        });

        it('фантом сильнее прочих разделов: даже если коробка ещё едет', async () => {
            findPlainCancelledInvoices.mockResolvedValue([{ ...invoice, status: 0 }]);

            await service.report();

            expect(body()).toContain('СЧЁТ УЖЕ РАСФОРМИРОВАН');
            expect(body()).not.toContain('ЕЩЁ В ПУТИ');
        });
    });

    describe('склейка и устойчивость', () => {
        it('несколько записей по одному счёту → одна строка, раздел по сильнейшему состоянию', async () => {
            listReturnsByPostings.mockResolvedValue([
                withState('MovingToOzon', { id: 1 }),
                withState('ReturnedToOzon', { id: 2 }),
            ]);

            await service.report();

            expect(emit.mock.calls[0][1]).toContain(': 1');
            expect(body().match(/№16713/g)).toHaveLength(1);
            expect(body()).toContain('ДОЕХАЛО ДО СКЛАДА МАРКЕТПЛЕЙСА');
            expect(body()).not.toContain('ЕЩЁ В ПУТИ');
        });

        it('два счёта с одним номером отправления → в письме оба', async () => {
            findPlainCancelledInvoices.mockResolvedValue([invoice, { ...invoice, scode: 99999, number: 17000 }]);
            listReturnsByPostings.mockResolvedValue([withState('ReturnedToOzon')]);

            await service.report();

            expect(emit.mock.calls[0][1]).toContain(': 2');
            expect(body()).toContain('№16713');
            expect(body()).toContain('№17000');
        });

        it('доехавшие и едущие разнесены по разделам, доехавшие выше', async () => {
            findPlainCancelledInvoices.mockResolvedValue([
                invoice,
                { ...invoice, scode: 93491, number: 16559, posting: '23876246-0500-1' },
            ]);
            listReturnsByPostings.mockResolvedValue([
                ozonReturn,
                withState('ReturnedToOzon', { posting_number: '23876246-0500-1' }),
            ]);

            await service.report();

            const arrivedAt = body().indexOf('ДОЕХАЛО ДО СКЛАДА МАРКЕТПЛЕЙСА');
            const transitAt = body().indexOf('ЕЩЁ В ПУТИ');
            expect(arrivedAt).toBeGreaterThan(-1);
            expect(transitAt).toBeGreaterThan(arrivedAt);
            expect(body().indexOf('№16559')).toBeLessThan(transitAt);
            expect(body().indexOf('№16713')).toBeGreaterThan(transitAt);
        });

        it('маркетплейс не ответил → отчёт не падает и письма о находках не шлёт', async () => {
            listReturnsByPostings.mockRejectedValue(new Error('502 Bad Gateway'));

            await expect(service.report()).resolves.toBeUndefined();

            expect(emit).not.toHaveBeenCalled();
        });

        it('база не ответила → письмо «сверка не собрана», крон не падает', async () => {
            findPlainCancelledInvoices.mockRejectedValue(new Error('connection lost'));

            await expect(service.report()).resolves.toBeUndefined();

            expect(emit).toHaveBeenCalledWith(
                'error.message',
                'Сверка отменённых счетов не собрана',
                'connection lost',
            );
        });
    });
});
