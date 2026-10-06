import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { MpEventService } from '../mp-event/mp-event.service';
import { MpDecisionService } from './mp-decision.service';
import { MpDecisionRunnerService } from './mp-decision.runner.service';

describe('MpDecisionRunnerService', () => {
    let service: MpDecisionRunnerService;
    const findByPosting = jest.fn();
    const getMarkCodesStateByScode = jest.fn();
    const getRealpriceLinesByScode = jest.fn();
    const hasAnyState = jest.fn();
    const emit = jest.fn();
    /** Флаги действий: по умолчанию всё выключено — как в итерации 5. */
    const flags: Record<string, boolean> = {};
    const configGet = jest.fn((key: string, def?: unknown) => flags[key] ?? def);
    const tx = { commit: jest.fn(), rollback: jest.fn() };
    const getTransaction = jest.fn();
    const getStorageSS = jest.fn().mockReturnValue(0);
    const markCodeFbsSold = jest.fn();
    const markCodeFbsUnsold = jest.fn();
    const markCodeReturnToStock = jest.fn();
    const updatePrim = jest.fn();
    const evIsHandled = jest.fn();
    const evMarkHandled = jest.fn();
    const evRecord = jest.fn();
    const evListUnhandled = jest.fn();
    const evListStates = jest.fn();

    const match = (over: any = {}) => ({
        invoice: { id: 91694, number: 8144, status: 3, remark: '72067989-0727-1' },
        mark: '',
        cancelled: false,
        closed: false,
        ...over,
    });

    beforeEach(async () => {
        [findByPosting, getMarkCodesStateByScode, getRealpriceLinesByScode, hasAnyState, emit].forEach((m) =>
            m.mockReset(),
        );
        delete flags.MP_SALE_ACTIONS_ENABLED;
        delete flags.MP_RETURN_ACTIONS_ENABLED;
        [
            getTransaction,
            markCodeFbsSold,
            markCodeFbsUnsold,
            markCodeReturnToStock,
            updatePrim,
            tx.commit,
            tx.rollback,
        ].forEach((m) => m.mockReset());
        getTransaction.mockResolvedValue(tx);
        findByPosting.mockResolvedValue(match());
        getMarkCodesStateByScode.mockResolvedValue([]);
        getRealpriceLinesByScode.mockResolvedValue([{ realpricecode: 1, goodscode: '531557', quantity: 1 }]);
        hasAnyState.mockResolvedValue(false);
        evIsHandled.mockReset().mockResolvedValue(false);
        evMarkHandled.mockReset().mockResolvedValue(undefined);
        evListStates.mockReset().mockResolvedValue([]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MpDecisionRunnerService,
                MpDecisionService,
                {
                    provide: INVOICE_SERVICE,
                    useValue: {
                        findByPosting,
                        getMarkCodesStateByScode,
                        getRealpriceLinesByScode,
                        getTransaction,
                        getStorageSS,
                        markCodeFbsSold,
                        markCodeFbsUnsold,
                        markCodeReturnToStock,
                        updatePrim,
                    },
                },
                {
                    provide: MpEventService,
                    useValue: {
                        hasAnyState,
                        isHandled: evIsHandled,
                        markHandled: evMarkHandled,
                        record: evRecord,
                        listUnhandled: evListUnhandled,
                        listStatesForPosting: evListStates,
                    },
                },
                { provide: EventEmitter2, useValue: { emit } },
                { provide: ConfigService, useValue: { get: configGet } },
            ],
        }).compile();
        service = module.get(MpDecisionRunnerService);
    });

    it('отмена FBS: «передано» берётся из журнала, а не из счёта', async () => {
        hasAnyState.mockResolvedValue(true);
        findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
        const decision = await service.observePosting('72067989-0727-1', 'FBS', 'cancel');
        expect(hasAnyState).toHaveBeenCalledWith('OZON', 'POSTING_FBS', '72067989-0727-1', ['delivering', 'delivered']);
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

    it('рутина продаж молчит: retire-решение письма не даёт, счётчик считает', async () => {
        // Решение владельца 14.08: писем слишком много — рутину видно во вкладке
        // «ЧЗ», в счётчиках и в утренней напоминалке, а не в пятиминутках.
        getMarkCodesStateByScode.mockResolvedValue([
            { ki: 'KI-1', status: 5, transferType: 3, retireReason: null, kmFull: 'KM-1' },
        ]);
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        await service.observePosting('72067989-0727-2', 'FBS', 'delivered');
        await service.flush('observeFbsWideWindow');

        expect(emit).not.toHaveBeenCalled();
        expect(service.getCounters()).toEqual({ 'delivered/normal': 2 });
    });

    it('письмо: одно на прогон, тема «Разобрать руками: N», одна строка на заказ, без шапки и счётчиков', async () => {
        findByPosting.mockResolvedValue(null); // delivered без счёта — «разобрать руками»
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        await service.observePosting('72067989-0727-2', 'FBS', 'delivered');
        await service.flush('observeFbsWideWindow');

        expect(emit).toHaveBeenCalledTimes(1);
        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toBe('Разобрать руками: 2');
        expect(body.split('\n')).toEqual([
            '72067989-0727-1 — счёта нет, а физика уже случилась. Разобрать руками.',
            '72067989-0727-2 — счёта нет, а физика уже случилась. Разобрать руками.',
        ]);
        // Служебное (флаги, потолок, счётчик веток) живёт в логе, не в письме.
        expect(body).not.toMatch(/Флаги|ВХОЛОСТУЮ|Счётчик веток|потолок/);
    });

    it('доставлен по помеченному счёту: журнал возвратов спрашиваем, возврат есть → тихо', async () => {
        findByPosting.mockResolvedValue(
            match({
                invoice: { id: 77437, number: 300300, status: 1, remark: '0113740615-0216-1 отмена FBO' },
                mark: ' отмена FBO',
                cancelled: true,
            }),
        );
        evListStates.mockResolvedValue(['WaitingShipment', 'MovingToOzon', 'ReturnedToOzon']);

        const decision = await service.observePosting('0113740615-0216-1', 'FBO', 'delivered');
        await service.flush('observeFboSales');

        expect(evListStates).toHaveBeenCalledWith('OZON', 'RETURN', '0113740615-0216-1');
        expect(decision.branch).toBe('delivered/marked-invoice/returned');
        expect(emit).not.toHaveBeenCalled();
    });

    it('доставлен по помеченному счёту без возврата → строка письма по макету', async () => {
        findByPosting.mockResolvedValue(
            match({
                invoice: { id: 77651, number: 300514, status: 1, remark: '0113740615-0300-1 отмена FBO' },
                mark: ' отмена FBO',
                cancelled: true,
            }),
        );
        evListStates.mockResolvedValue(['WaitingShipment']);

        await service.observePosting('0113740615-0300-1', 'FBO', 'delivered');
        await service.flush('observeFboSales');

        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toBe('Разобрать руками: 1');
        expect(body).toBe(
            '0113740615-0300-1 — доставлен, а счёт уже в донорах и возврата по заказу нет — товар мог уйти дважды' +
                '; счёт №300514 (сформирован, не в работе, пометка «отмена FBO»). Разобрать руками.',
        );
    });

    it('обычная доставка журнал возвратов не читает', async () => {
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        expect(evListStates).not.toHaveBeenCalled();
    });

    it('нечего показать → письма нет', async () => {
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        await service.flush('observeFbsWideWindow');
        expect(emit).not.toHaveBeenCalled();
    });

    it('потолок разбора за прогон: лишнее не считаем; потолок — в лог, письма без строк «руками» нет', async () => {
        for (let i = 0; i < 205; i++) await service.observePosting(`P-${i}`, 'FBS', 'delivered');
        expect(findByPosting).toHaveBeenCalledTimes(200);

        await service.flush('observeFbsWideWindow');
        expect(emit).not.toHaveBeenCalled();

        // потолок восстанавливается к следующему прогону
        await service.observePosting('P-206', 'FBS', 'delivered');
        expect(findByPosting).toHaveBeenCalledTimes(201);
    });

    it('счётчик копится, буфер письма — нет', async () => {
        await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
        await service.flush('cycle-1');
        await service.observePosting('72067989-0727-2', 'FBS', 'delivered');
        await service.flush('cycle-2');
        expect(service.getCounters()).toEqual({ 'delivered/normal': 2 });
    });

    describe('исполнение (итерации 7 и 8)', () => {
        const codeState = (over: any = {}) => ({
            ki: 'KI-1',
            status: 5,
            transferType: 3,
            retireReason: null,
            kmFull: 'KM-1',
            ...over,
        });

        it('флаги выключены → needsExecution false, execute не трогает базу', async () => {
            getMarkCodesStateByScode.mockResolvedValue([codeState()]);
            const decision = await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
            expect(service.needsExecution(decision)).toBe(false);

            await service.execute(decision);
            expect(markCodeFbsSold).not.toHaveBeenCalled();
        });

        it('итерация 7: retire по флагу продажи — MARKCODE_FBS_SOLD в транзакции, письмо молчит (рутина)', async () => {
            flags.MP_SALE_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState()]);
            const decision = await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
            expect(service.needsExecution(decision)).toBe(true);

            const outcome = await service.execute(decision);

            expect(markCodeFbsSold).toHaveBeenCalledWith('KI-1', tx);
            expect(tx.commit).toHaveBeenCalled();
            expect(outcome.done).toEqual(['вывод из оборота KI-1']);

            // Успешная продажа — не повод для письма: КИ уже ждёт во вкладке «ЧЗ».
            await service.flush('observeFbsWideWindow');
            expect(emit).not.toHaveBeenCalled();
        });

        it('итерация 8: ReturnedToOzon — unretire РАНЬШЕ донора', async () => {
            flags.MP_RETURN_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState({ status: 6, retireReason: 1 })]);
            const decision = await service.observeReturn({
                id: 1,
                posting_number: '72067989-0727-1',
                schema: 'Fbs',
                visual: { status: { sys_name: 'ReturnedToOzon' } },
            });
            expect(service.needsExecution(decision)).toBe(true);

            const outcome = await service.execute(decision);

            expect(markCodeFbsUnsold).toHaveBeenCalledWith('KI-1', tx);
            expect(updatePrim).toHaveBeenCalledWith('72067989-0727-1', '72067989-0727-1 отмена FBO', tx);
            expect(markCodeFbsUnsold.mock.invocationCallOrder[0]).toBeLessThan(updatePrim.mock.invocationCallOrder[0]);
            expect(outcome.done).toEqual(['возврат в оборот KI-1', 'донор 72067989-0727-1']);
        });

        it('ВБ-возврат ReturnedToOzon → донор с СВОИМ суффиксом « отмена WBFBO», не озоновским', async () => {
            flags.MP_RETURN_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '568746' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState({ status: 6, retireReason: 1 })]);
            const decision = await service.observeReturn(
                {
                    id: 'uuid-claim-1',
                    posting_number: '568746',
                    schema: 'Fbs',
                    visual: { status: { sys_name: 'ReturnedToOzon' } },
                },
                undefined,
                'WB',
            );

            await service.execute(decision);

            // Чужой суффикс отдал бы партию и код донорскому пулу Ozon.
            expect(updatePrim).toHaveBeenCalledWith('568746', '568746 отмена WBFBO', tx);
        });

        it('handleDelivered: решение → retire → пометка в журнале; сервис события уходит в решение', async () => {
            flags.MP_SALE_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '568746' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState({ status: 5, transferType: 3 })]);
            const event = {
                service: 'WB',
                kind: 'POSTING_FBS',
                extId: '568746',
                state: 'delivered',
                posting: '568746',
            } as any;

            await service.handleDelivered(event);

            expect(markCodeFbsSold).toHaveBeenCalledWith('KI-1', tx);
            expect(evMarkHandled).toHaveBeenCalledWith(event);
        });

        it('handleDelivered: уже обработанное событие не пересчитывается', async () => {
            flags.MP_SALE_ACTIONS_ENABLED = true;
            evIsHandled.mockResolvedValue(true);

            await service.handleDelivered({
                service: 'WB',
                kind: 'POSTING_FBS',
                extId: '568746',
                state: 'delivered',
                posting: '568746',
            } as any);

            expect(findByPosting).not.toHaveBeenCalled();
            expect(evMarkHandled).not.toHaveBeenCalled();
        });

        it('handleDelivered: сбой исполнения — событие НЕ помечено, придёт на ретрай', async () => {
            flags.MP_SALE_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '568746' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState({ status: 5, transferType: 3 })]);
            markCodeFbsSold.mockRejectedValue(new Error('DB down'));

            await service.handleDelivered({
                service: 'WB',
                kind: 'POSTING_FBS',
                extId: '568746',
                state: 'delivered',
                posting: '568746',
            } as any);

            expect(evMarkHandled).not.toHaveBeenCalled();
        });

        it('итерация 8: ReceivedBySeller — unretire, затем TT 3→0; счёт не трогаем', async () => {
            flags.MP_RETURN_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState({ status: 6, retireReason: 1 })]);
            const decision = await service.observeReturn({
                id: 2,
                posting_number: '72067989-0727-1',
                schema: 'Fbs',
                visual: { status: { sys_name: 'ReceivedBySeller' } },
            });

            const outcome = await service.execute(decision);

            expect(markCodeFbsUnsold).toHaveBeenCalledWith('KI-1', tx);
            expect(markCodeReturnToStock).toHaveBeenCalledWith('KI-1', 0, tx);
            expect(markCodeFbsUnsold.mock.invocationCallOrder[0]).toBeLessThan(
                markCodeReturnToStock.mock.invocationCallOrder[0],
            );
            expect(updatePrim).not.toHaveBeenCalled();
            expect(outcome.done).toEqual(['возврат в оборот KI-1', 'снятие с отгрузки KI-1']);
        });

        it('слои независимы: гард SP (ANY_EXCEPTION) не блокирует донора и уходит в письмо', async () => {
            flags.MP_RETURN_ACTIONS_ENABLED = true;
            markCodeFbsUnsold.mockRejectedValue(
                new Error('exception 1, ANY_EXCEPTION, КМ выведен не нашей продажей (RETIRE_REASON<>1)'),
            );
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState({ status: 6, retireReason: 1 })]);
            const decision = await service.observeReturn({
                id: 3,
                posting_number: '72067989-0727-1',
                schema: 'Fbs',
                visual: { status: { sys_name: 'ReturnedToOzon' } },
            });

            const outcome = await service.execute(decision);

            expect(updatePrim).toHaveBeenCalled();
            expect(tx.commit).toHaveBeenCalled();
            expect(outcome.failed).toEqual([
                'возврат в оборот KI-1 — exception 1, ANY_EXCEPTION, КМ выведен не нашей продажей (RETIRE_REASON<>1)',
            ]);

            await service.flush('processReturns');
            const [, , body] = emit.mock.calls[0];
            expect(body).toContain('. НЕ ПРОШЛО: возврат в оборот KI-1 — exception 1, ANY_EXCEPTION');
            expect(body).toContain('СДЕЛАНО: донор 72067989-0727-1');
            expect(body).toMatch(/Разобрать руками\.$/);
        });

        it('настоящий сбой (без ANY_EXCEPTION) → откат, проброс наружу, в письме нет «СДЕЛАНО»', async () => {
            flags.MP_RETURN_ACTIONS_ENABLED = true;
            tx.commit.mockClear();
            tx.rollback.mockClear().mockResolvedValue(undefined);
            // unretire прошёл, а донор упал по инфраструктуре — сделанное откатывается вместе с транзакцией
            updatePrim.mockRejectedValueOnce(new Error('Connection reset by peer'));
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState({ status: 6, retireReason: 1 })]);
            const decision = await service.observeReturn({
                id: 4,
                posting_number: '72067989-0727-1',
                schema: 'Fbs',
                visual: { status: { sys_name: 'ReturnedToOzon' } },
            });

            await expect(service.execute(decision)).rejects.toThrow('Connection reset by peer');

            expect(tx.commit).not.toHaveBeenCalled();
            expect(tx.rollback).toHaveBeenCalled();

            await service.flush('processReturns');
            const [, , body] = emit.mock.calls[0];
            // прошедший до сбоя unretire откатился — письмо не рапортует о нём как о сделанном
            expect(body).not.toContain('СДЕЛАНО: возврат в оборот');
            expect(body).toContain('событие уйдёт в ретрай');
        });

        it('отмены исполнитель не трогает даже со включёнными флагами', async () => {
            flags.MP_SALE_ACTIONS_ENABLED = true;
            flags.MP_RETURN_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 3, remark: '72067989-0727-1' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState()]);
            const decision = await service.observePosting('72067989-0727-1', 'FBS', 'cancel');
            expect(service.needsExecution(decision)).toBe(false);

            await service.execute(decision);

            expect(getTransaction).not.toHaveBeenCalled();
            expect(updatePrim).not.toHaveBeenCalled();
        });

        it('внешняя транзакция не коммитится исполнителем', async () => {
            flags.MP_SALE_ACTIONS_ENABLED = true;
            findByPosting.mockResolvedValue(match({ invoice: { id: 91694, status: 4, remark: '72067989-0727-1' } }));
            getMarkCodesStateByScode.mockResolvedValue([codeState()]);
            const decision = await service.observePosting('72067989-0727-1', 'FBS', 'delivered');
            const outer = { commit: jest.fn(), rollback: jest.fn() } as any;

            await service.execute(decision, outer);

            expect(markCodeFbsSold).toHaveBeenCalledWith('KI-1', outer);
            expect(outer.commit).not.toHaveBeenCalled();
            expect(tx.commit).not.toHaveBeenCalled();
        });
    });

    describe('ingestDelivered / drainDelivered — общая цепочка «увидели доставку»', () => {
        const ev = (kind: 'POSTING_FBS' | 'POSTING_FBO' = 'POSTING_FBO') => ({
            service: 'OZON' as const,
            kind,
            extId: 'P-1',
            state: 'delivered',
            posting: 'P-1',
        });

        beforeEach(() => {
            evRecord.mockReset();
            evListUnhandled.mockReset().mockResolvedValue([]);
            evIsHandled.mockReset().mockResolvedValue(false);
            evMarkHandled.mockReset();
            findByPosting.mockReset().mockResolvedValue(null);
            delete flags['MP_SALE_ACTIONS_ENABLED'];
        });

        it('новое событие при включённых продажах → handleDelivered (решение + пометка)', async () => {
            flags['MP_SALE_ACTIONS_ENABLED'] = true;
            evRecord.mockResolvedValue(true);
            const handle = jest.spyOn(service, 'handleDelivered');

            expect(await service.ingestDelivered(ev())).toBe(true);

            expect(evRecord).toHaveBeenCalledWith(ev());
            expect(handle).toHaveBeenCalledWith(ev());
            expect(evMarkHandled).toHaveBeenCalledWith(ev());
        });

        it('знакомое событие — ни решения, ни пометки (его подберёт добор)', async () => {
            flags['MP_SALE_ACTIONS_ENABLED'] = true;
            evRecord.mockResolvedValue(false);
            const handle = jest.spyOn(service, 'handleDelivered');

            expect(await service.ingestDelivered(ev())).toBe(false);

            expect(handle).not.toHaveBeenCalled();
            expect(evMarkHandled).not.toHaveBeenCalled();
        });

        it('продажи выключены → решение вхолостую, пометки нет; схема по виду события', async () => {
            evRecord.mockResolvedValue(true);
            const observe = jest.spyOn(service, 'observePosting');

            expect(await service.ingestDelivered(ev('POSTING_FBO'), undefined)).toBe(true);

            expect(observe).toHaveBeenCalledWith('P-1', 'FBO', 'delivered', undefined, 'OZON');
            expect(evMarkHandled).not.toHaveBeenCalled();
        });

        it('сбой записи в журнал — предупреждение, решения нет', async () => {
            flags['MP_SALE_ACTIONS_ENABLED'] = true;
            evRecord.mockRejectedValue(new Error('db down'));
            const handle = jest.spyOn(service, 'handleDelivered');

            expect(await service.ingestDelivered(ev())).toBe(false);
            expect(handle).not.toHaveBeenCalled();
        });

        it('drain: необработанное из журнала исполняется по виду события, при выключенных продажах в журнал не ходим', async () => {
            await service.drainDelivered('WB', 'POSTING_FBO');
            expect(evListUnhandled).not.toHaveBeenCalled();

            flags['MP_SALE_ACTIONS_ENABLED'] = true;
            evListUnhandled.mockResolvedValue([{ extId: 'S-1', posting: 'S-1' }]);
            const handle = jest.spyOn(service, 'handleDelivered').mockResolvedValue(undefined);

            await service.drainDelivered('WB', 'POSTING_FBO');

            expect(evListUnhandled).toHaveBeenCalledWith('WB', 'POSTING_FBO', 'delivered');
            expect(handle).toHaveBeenCalledWith({
                service: 'WB',
                kind: 'POSTING_FBO',
                extId: 'S-1',
                state: 'delivered',
                posting: 'S-1',
            });
        });

        it('drain: сбой журнала не роняет прогон', async () => {
            flags['MP_SALE_ACTIONS_ENABLED'] = true;
            evListUnhandled.mockRejectedValue(new Error('db down'));
            await expect(service.drainDelivered('OZON', 'POSTING_FBO')).resolves.toBeUndefined();
        });
    });
});
