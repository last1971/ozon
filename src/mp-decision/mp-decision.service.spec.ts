import { Test, TestingModule } from '@nestjs/testing';
import { MpDecisionService } from './mp-decision.service';
import {
    DecisionCode,
    DecisionInput,
    IN_TRANSIT_RETURN_STATES,
    TO_MARKETPLACE_TRANSIT_STATES,
    TO_SELLER_TRANSIT_STATES,
    TOWARDS_SELLER_STATES,
    UNKNOWN_DIRECTION_TRANSIT_STATES,
    returnWhereabouts,
} from './mp-decision.types';

describe('MpDecisionService — решающая таблица', () => {
    let service: MpDecisionService;

    const invoice = (over: Partial<DecisionInput['invoice']> = {}) => ({
        id: 91694,
        number: 4321,
        status: 3,
        mark: '',
        cancelled: false,
        closed: false,
        ...over,
    });
    const code = (over: Partial<DecisionCode> = {}): DecisionCode => ({
        ki: '0100400000013930215fajB',
        status: 5,
        transferType: 3,
        retireReason: null,
        kmFull: 'KM_FULL',
        ...over,
    });
    const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
        kind: 'cancel',
        scheme: 'FBS',
        postingNumber: '72067989-0727-1',
        invoice: invoice(),
        codes: [],
        ...over,
    });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({ providers: [MpDecisionService] }).compile();
        service = module.get(MpDecisionService);
    });

    describe('счёт не найден', () => {
        it('отмена FBO → ничего и БЕЗ письма: счёта не было, делать нечего', () => {
            const decision = service.decide(input({ scheme: 'FBO', invoice: null }));
            expect(decision).toMatchObject({ branch: 'invoice-not-found', layer1: 'none', letter: false, layer2: [] });
        });

        it('отмена FBS → тоже без письма: заказ отменили раньше, чем крон завёл счёт', () => {
            expect(service.decide(input({ invoice: null }))).toMatchObject({ letter: false });
        });

        it('доставлено → письмо: уехало то, чего мы не заводили', () => {
            expect(service.decide(input({ kind: 'delivered', invoice: null }))).toMatchObject({
                branch: 'invoice-not-found',
                letter: true,
            });
        });

        it.each(['ReturnedToOzon', 'ReceivedBySeller', 'WriteOff'])(
            'возврат %s → письмо: физика случилась по неизвестному заказу',
            (state) => {
                expect(
                    service.decide(input({ kind: 'return', returnState: state, invoice: null })),
                ).toMatchObject({ letter: true });
            },
        );

        it.each(['MovingToOzon', 'Rejected'])('возврат %s → без письма: физики нет', (state) => {
            expect(service.decide(input({ kind: 'return', returnState: state, invoice: null }))).toMatchObject({
                letter: false,
            });
        });
    });

    describe('слой 1 — доставка', () => {
        it('обычный счёт → ничего и без письма (закрытие по комиссиям своим путём)', () => {
            const decision = service.decide(input({ kind: 'delivered' }));
            expect(decision).toMatchObject({ branch: 'delivered/normal', layer1: 'none', letter: false });
        });

        it('счёт с пометкой отмены → ничего, письмо', () => {
            const decision = service.decide(
                input({ kind: 'delivered', invoice: invoice({ mark: ' отмена FBO', cancelled: true, status: 1 }) }),
            );
            expect(decision).toMatchObject({ branch: 'delivered/marked-invoice', layer1: 'none', letter: true });
        });
    });

    describe('слой 1 — отмена', () => {
        it('FBO подобранный (STATUS=4) → ждём запись возврата: она решит, донор или приём у нас', () => {
            const decision = service.decide(input({ scheme: 'FBO', invoice: invoice({ status: 4 }) }));
            expect(decision).toMatchObject({ branch: 'cancel-fbo/picked', layer1: 'none', letter: false });
        });

        it('FBO недобор (STATUS=3) → донор сразу', () => {
            const decision = service.decide(input({ scheme: 'FBO', invoice: invoice({ status: 3 }) }));
            expect(decision).toMatchObject({ branch: 'cancel-fbo/unpicked', layer1: 'make-donor', letter: false });
        });

        it('счёт закрыт (обе схемы) → не трогаем, письмо', () => {
            const decision = service.decide(input({ invoice: invoice({ status: 5, mark: ' закрыт', closed: true }) }));
            expect(decision).toMatchObject({ branch: 'cancel/closed-invoice', layer1: 'none', letter: true });
        });

        it('счёт уже помечен отменой → ничего и без письма (идемпотентность)', () => {
            const decision = service.decide(input({ invoice: invoice({ mark: ' отмена', cancelled: true, status: 0 }) }));
            expect(decision).toMatchObject({ branch: 'cancel/already-marked', layer1: 'none', letter: false });
        });

        it('FBS, товар уже у Ozon → счёт не трогаем, ждём запись возврата (решение 11.08)', () => {
            const decision = service.decide(input({ transferred: true, invoice: invoice({ status: 4 }) }));
            expect(decision).toMatchObject({ branch: 'cancel-fbs/transferred', layer1: 'none', letter: false });
        });

        it('FBS, STATUS=4 → коды на склад, счёт под расформирование, письмо кладовщику', () => {
            const decision = service.decide(input({ invoice: invoice({ status: 4 }) }));
            expect(decision).toMatchObject({
                branch: 'cancel-fbs/picked',
                layer1: 'cancel-fbs-picked',
                letter: true,
            });
        });

        it('FBS, STATUS=3 → отвязать коды, снять подборку, гасить счёт', () => {
            const decision = service.decide(input({ invoice: invoice({ status: 3 }) }));
            expect(decision).toMatchObject({
                branch: 'cancel-fbs/in-pick',
                layer1: 'cancel-fbs-unpicked',
                letter: true,
            });
        });

        it('FBS, состояние счёта вне набора → ничего, письмо', () => {
            const decision = service.decide(input({ invoice: invoice({ status: 2 }) }));
            expect(decision).toMatchObject({ branch: 'cancel-fbs/status-unexpected', layer1: 'none', letter: true });
        });
    });

    describe('слой 1 — возвраты', () => {
        const ret = (state: string, over: Partial<DecisionInput> = {}) =>
            service.decide(input({ kind: 'return', returnState: state, ...over }));

        it.each(['Cancelled', 'Rejected', 'Approved', 'MoneyReturned', 'CrmRejected', 'CancelledDisputeNotOpen'])(
            'заявочный статус %s → ничего и без письма: физики нет',
            (state) => {
                expect(ret(state)).toMatchObject({ branch: 'return/claim-state', layer1: 'none', letter: false });
            },
        );

        it.each(['MovingToOzon', 'WaitingShipment', 'MovingToSeller'])('%s → только запись в журнал', (state) => {
            expect(ret(state)).toMatchObject({ branch: 'return/in-transit', layer1: 'none', letter: false });
        });

        // Наборы разведены по направлению (26.08.2026), но состав «в пути» обязан
        // остаться прежним: решения по нему те же, изменилась только структура.
        it('наборы направлений в сумме дают прежний состав «в пути»', () => {
            expect([...IN_TRANSIT_RETURN_STATES].sort()).toEqual(
                ['MovingToOzon', 'MovingToSeller', 'WaitingShipment'].sort(),
            );
            expect(TO_MARKETPLACE_TRANSIT_STATES).toEqual(['MovingToOzon']);
            expect(TO_SELLER_TRANSIT_STATES).toEqual(['MovingToSeller']);
            // Направление по имени не определяется — держим отдельно и решений не принимаем.
            expect(UNKNOWN_DIRECTION_TRANSIT_STATES).toEqual(['WaitingShipment']);
            // «Товар у нас или едет к нам» = путь к нам, приезд к нам и наш пункт возврата.
            expect([...TOWARDS_SELLER_STATES].sort()).toEqual(
                ['MovingToSeller', 'ReceivedBySeller', 'ArrivedAtReturnPlace'].sort(),
            );
            // Но в «в пути» пункт возврата НЕ входит: по нему решающая таблица шлёт письмо.
            expect(IN_TRANSIT_RETURN_STATES).not.toContain('ArrivedAtReturnPlace');
        });

        it.each([
            ['Cancelled', 'claim'],
            ['MovingToOzon', 'towards-marketplace'],
            ['ReturnedToOzon', 'at-marketplace'],
            ['MovingToSeller', 'towards-seller'],
            ['ReceivedBySeller', 'towards-seller'],
            ['WriteOff', 'lost'],
            // Направление по имени не определяется: выходит и к Ozon, и к нам.
            ['WaitingShipment', 'unknown'],
            // Незнакомое состояние — тоже unknown: действий по нему принимать нельзя.
            // Пункт возврата ПРОДАВЦА: коробка ждёт нас, а не едет к маркетплейсу.
            ['ArrivedAtReturnPlace', 'towards-seller'],
            ['Чепуха', 'unknown'],
        ])('returnWhereabouts(%s) = %s — единственное место, где решается «где товар»', (state, expected) => {
            expect(returnWhereabouts(state)).toBe(expected);
        });

        // ArrivedAtReturnPlace — пункт возврата ПРОДАВЦА (place = target_place = ТОМСК_70
        // на всех трёх живых случаях). В «в пути» он намеренно НЕ попал: сегодня это
        // единственный сигнал «коробка ждёт, заберите», и глушить его нечем.
        it('ArrivedAtReturnPlace по-прежнему просит рук, а не молчит', () => {
            expect(ret('ArrivedAtReturnPlace')).toMatchObject({ branch: 'return/unknown-state', letter: true });
        });

        it.each(['WriteOff', 'PotentiallyLost', 'Utilized'])('%s → ничего, письмо', (state) => {
            expect(ret(state)).toMatchObject({ branch: 'return/lost', layer1: 'none', letter: true });
        });

        it('частичный возврат → ничего, письмо (автоматики под него нет)', () => {
            expect(ret('ReturnedToOzon', { partial: true })).toMatchObject({
                branch: 'return/partial',
                layer1: 'none',
                letter: true,
            });
        });

        it('ReturnedToOzon → счёт в доноры', () => {
            expect(ret('ReturnedToOzon')).toMatchObject({ branch: 'return/returned-to-ozon', layer1: 'make-donor' });
        });

        it('ReturnedToOzon по закрытому счёту → донора НЕ делаем, письмо', () => {
            expect(ret('ReturnedToOzon', { invoice: invoice({ status: 5, closed: true, mark: ' закрыт' }) })).toMatchObject({
                branch: 'return/returned-to-ozon/closed-invoice',
                layer1: 'none',
                letter: true,
            });
        });

        it('ReturnedToOzon по уже помеченному счёту → ничего (донор сделан раньше)', () => {
            expect(
                ret('ReturnedToOzon', { invoice: invoice({ status: 1, cancelled: true, mark: ' отмена FBO' }) }),
            ).toMatchObject({ branch: 'return/returned-to-ozon/already-donor', layer1: 'none', letter: false });
        });

        it('ReceivedBySeller → автоматом ничего, приём руками', () => {
            expect(ret('ReceivedBySeller')).toMatchObject({
                branch: 'return/received-by-seller',
                layer1: 'none',
                letter: true,
            });
        });

        it('ReceivedBySeller по уже расформированному счёту (STATUS=0) → тихо, приём завершён', () => {
            // живой случай магазина 13.08: хвост первого прогона поднял 5 давно разобранных
            expect(ret('ReceivedBySeller', { invoice: invoice({ status: 0, mark: ' получен' }) })).toMatchObject({
                branch: 'return/received-by-seller/already-received',
                layer1: 'none',
                letter: false,
            });
        });

        it('статус возврата вне набора → ничего, письмо', () => {
            expect(ret('CompensationRejected')).toMatchObject({ branch: 'return/unknown-state', letter: true });
        });
    });

    describe('слой 2 — коды', () => {
        it('доставка, TT=3 STATUS=5 → 5→6 без письма: КИ ждёт во вкладке «ЧЗ» (решение 14.08)', () => {
            const decision = service.decide(input({ kind: 'delivered', codes: [code()] }));
            expect(decision.layer2[0]).toMatchObject({ actions: ['retire'], letter: false, kmFull: 'KM_FULL' });
        });

        it('доставка, код уже выведен → ничего: идемпотентность', () => {
            const decision = service.decide(input({ kind: 'delivered', codes: [code({ status: 6, retireReason: 1 })] }));
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: false });
        });

        it('доставка, состояние вне набора → письмо', () => {
            const decision = service.decide(input({ kind: 'delivered', codes: [code({ transferType: 0 })] }));
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: true });
        });

        it('отмена FBS при STATUS=3 → отвязать все коды TT=3', () => {
            const decision = service.decide(input({ invoice: invoice({ status: 3 }), codes: [code()] }));
            expect(decision.layer2[0]).toMatchObject({ actions: ['detach'], letter: false });
        });

        it('отмена по уже помеченному счёту → слой 2 молчит, а не шлёт письмо на каждый код', () => {
            const decision = service.decide(
                input({ invoice: invoice({ status: 1, mark: ' отмена FBO', cancelled: true }), codes: [code()] }),
            );
            expect(decision.branch).toBe('cancel/already-marked');
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: false });
        });

        it('отмена FBS при STATUS=4 → TT 3→0, привязка остаётся', () => {
            const decision = service.decide(input({ invoice: invoice({ status: 4 }), codes: [code()] }));
            expect(decision.layer2[0]).toMatchObject({ actions: ['return-to-stock'], letter: false });
        });

        it('отмена отгруженной FBS → код остаётся TT=3, ждём запись возврата', () => {
            const decision = service.decide(
                input({ transferred: true, invoice: invoice({ status: 4 }), codes: [code()] }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: false });
        });

        it('отмена FBO → TT НЕ трогаем, иначе код не переедет миграцией', () => {
            const decision = service.decide(input({ scheme: 'FBO', codes: [code()] }));
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: false });
        });

        it('ReturnedToOzon, код выведен нашей продажей → 6→5 до того, как счёт станет донором', () => {
            const decision = service.decide(
                input({
                    kind: 'return',
                    returnState: 'ReturnedToOzon',
                    codes: [code({ status: 6, retireReason: 1 })],
                }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: ['unretire'], letter: false });
        });

        it('ReturnedToOzon, код уже в обороте → ничего', () => {
            const decision = service.decide(
                input({ kind: 'return', returnState: 'ReturnedToOzon', codes: [code({ status: 5 })] }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: false });
        });

        it('ReceivedBySeller, код выведен нашей продажей → 6→5, затем TT 3→0', () => {
            const decision = service.decide(
                input({
                    kind: 'return',
                    returnState: 'ReceivedBySeller',
                    codes: [code({ status: 6, retireReason: 1 })],
                }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: ['unretire', 'return-to-stock'], letter: true });
        });

        it('ReceivedBySeller, код в обороте → TT 3→0 и письмо «изначально FBS»', () => {
            const decision = service.decide(
                input({ kind: 'return', returnState: 'ReceivedBySeller', codes: [code()] }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: ['return-to-stock'], letter: true });
        });

        it('возврат, TT=2 → ничего с кодом, письмо: откат только корректировкой УПД-2', () => {
            const decision = service.decide(
                input({
                    kind: 'return',
                    returnState: 'ReceivedBySeller',
                    codes: [code({ transferType: 2, status: 6, retireReason: 3 })],
                }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: true });
        });

        it('возврат, код выведен по другой причине → ничего, письмо', () => {
            const decision = service.decide(
                input({
                    kind: 'return',
                    returnState: 'ReturnedToOzon',
                    codes: [code({ status: 6, retireReason: 2 })],
                }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: true });
        });

        it('статус возврата без действий над кодами не порождает писем по каждому коду', () => {
            const decision = service.decide(
                input({ kind: 'return', returnState: 'MovingToOzon', codes: [code()] }),
            );
            expect(decision.layer2[0]).toMatchObject({ actions: [], letter: false });
        });
    });
});
