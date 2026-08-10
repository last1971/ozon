import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionService } from './mp-decision.service';
import { MpDecisionDryRunService } from './mp-decision.dry-run.service';

describe('MpDecisionDryRunService', () => {
    let service: MpDecisionDryRunService;
    const findByPosting = jest.fn();
    const getMarkCodesStateByScode = jest.fn();
    const getRealpriceLinesByScode = jest.fn();
    const hasAnyState = jest.fn();
    const emit = jest.fn();

    const match = (over: any = {}) => ({
        invoice: { id: 91694, status: 3, remark: '72067989-0727-1' },
        mark: '',
        cancelled: false,
        closed: false,
        ...over,
    });

    beforeEach(async () => {
        [findByPosting, getMarkCodesStateByScode, getRealpriceLinesByScode, hasAnyState, emit].forEach((m) =>
            m.mockReset(),
        );
        findByPosting.mockResolvedValue(match());
        getMarkCodesStateByScode.mockResolvedValue([]);
        getRealpriceLinesByScode.mockResolvedValue([{ realpricecode: 1, goodscode: '531557', quantity: 1 }]);
        hasAnyState.mockResolvedValue(false);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MpDecisionDryRunService,
                MpDecisionService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: { findByPosting, getMarkCodesStateByScode, getRealpriceLinesByScode },
                },
                { provide: MpEventService, useValue: { hasAnyState } },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get(MpDecisionDryRunService);
    });

    it('отмена FBS: «передано» берётся из журнала, а не из счёта', async () => {
        hasAnyState.mockResolvedValue(true);
        findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
        const decision = await service.observePosting('72067989-0727-1', 'FBS', 'cancel');
        expect(hasAnyState).toHaveBeenCalledWith('OZON', 'POSTING_FBS', '72067989-0727-1', [
            'delivering',
            'delivered',
        ]);
        expect(decision.branch).toBe('cancel-fbs/transferred');
    });

    it('отмена FBO журнал не спрашивает', async () => {
        await service.observePosting('33261943-0361-1', 'FBO', 'cancel');
        expect(hasAnyState).not.toHaveBeenCalled();
    });

    const returnItem = {
        id: 1,
        posting_number: '72067989-0727-1',
        schema: 'Fbs',
        visual: { status: { sys_name: 'ReturnedToOzon' } },
    };

    it('возврат: записей меньше, чем единиц в отправлении → ветка частичного', async () => {
        const decision = await service.observeReturn(returnItem, { returnedRows: 1, postingUnits: 2 });
        expect(decision.branch).toBe('return/partial');
    });

    it('возврат: записей столько же, сколько единиц → обычная ветка', async () => {
        const decision = await service.observeReturn(returnItem, { returnedRows: 1, postingUnits: 1 });
        expect(decision.branch).toBe('return/returned-to-ozon');
    });

    it('состав отправления неизвестен → о частичности не судим, состав счёта не спрашиваем', async () => {
        const decision = await service.observeReturn(returnItem);
        expect(decision.branch).toBe('return/returned-to-ozon');
        expect(decision.input.partial).toBeUndefined();
        // количества в счёте — в штуках с коэффициентом кратности, для частичности негодны
        expect(getRealpriceLinesByScode).not.toHaveBeenCalled();
    });

    it('ничего не меняет: у сервиса счетов дёргаются только читающие методы', async () => {
        await service.observePosting('72067989-0727-1', 'FBS', 'cancel');
        expect(findByPosting).toHaveBeenCalled();
        expect(getMarkCodesStateByScode).toHaveBeenCalledWith(91694, null);
    });

    it('сбой чтения не роняет вызывающего', async () => {
        findByPosting.mockRejectedValue(new Error('DB down'));
        await expect(service.observePosting('72067989-0727-1', 'FBS', 'cancel')).resolves.toBeNull();
    });

    it('flush шлёт одно письмо на прогон и считает ветки', async () => {
        getMarkCodesStateByScode.mockResolvedValue([
            { ki: 'KI-1', status: 5, transferType: 3, retireReason: null, kmFull: 'KM-1' },
        ]);
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        await service.observePosting('72067989-0727-2', 'FBS', 'delivered');
        service.flush('observeFbsWideWindow');

        expect(emit).toHaveBeenCalledTimes(1);
        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toContain('вхолостую');
        expect(body).toContain('ВХОЛОСТУЮ');
        expect(body).toContain('retire');
        expect(body).toContain('KM_FULL: KM-1');
        expect(body).toContain('delivered/normal: 2');
        expect(service.getCounters()).toEqual({ 'delivered/normal': 2 });
    });

    it('нечего показать → письма нет', async () => {
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        service.flush('observeFbsWideWindow');
        expect(emit).not.toHaveBeenCalled();
    });

    it('потолок разбора за прогон: лишнее не считаем, но и не молчим', async () => {
        for (let i = 0; i < 205; i++) await service.observePosting(`P-${i}`, 'FBS', 'delivered');
        expect(findByPosting).toHaveBeenCalledTimes(200);

        service.flush('observeFbsWideWindow');
        const [, , body] = emit.mock.calls[0];
        expect(body).toContain('5 событий за этот прогон не разобрано');

        // потолок восстанавливается к следующему прогону
        emit.mockClear();
        await service.observePosting('P-206', 'FBS', 'delivered');
        expect(findByPosting).toHaveBeenCalledTimes(201);
    });

    it('счётчик копится, буфер письма — нет', async () => {
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        service.flush('cycle-1');
        await service.observePosting('72067989-0727-2', 'FBS', 'delivered');
        service.flush('cycle-2');
        expect(service.getCounters()).toEqual({ 'delivered/normal': 2 });
    });
});
