import { wbClaimState, wbEventState, wbShipped } from './wb.status.helper';
import { WbClaimDto } from '../wb.customer/dto/wb.claim.dto';

describe('wb.status.helper — единая точка нормализации статусов ВБ', () => {
    describe('wbEventState', () => {
        it('sold → delivered', () => {
            expect(wbEventState('sold')).toBe('delivered');
        });

        it.each(['canceled', 'canceled_by_client', 'declined_by_client', 'defect'])('%s → cancelled', (st) => {
            expect(wbEventState(st)).toBe('cancelled');
        });

        it('промежуточные статусы идут как есть', () => {
            expect(wbEventState('waiting')).toBe('waiting');
            expect(wbEventState('ready_for_pickup')).toBe('ready_for_pickup');
        });
    });

    describe('wbShipped', () => {
        it('supplierStatus=complete — отгружен (переживает терминальный canceled)', () => {
            expect(wbShipped('complete')).toBe(true);
        });

        it('не complete — не отгружен: отказ в первый час не должен делать фантомного донора', () => {
            expect(wbShipped('new')).toBe(false);
            expect(wbShipped('confirm')).toBe(false);
            expect(wbShipped('cancel')).toBe(false);
        });
    });

    describe('wbClaimState — заявка на возврат → озоновский словарь', () => {
        const claim = (status_ex: number, status = 2): WbClaimDto => ({ status_ex, status }) as WbClaimDto;

        it('на рассмотрении (0) → null: события не порождаем, решение придёт сменой статуса', () => {
            expect(wbClaimState(claim(0, 0), false)).toBeNull();
        });

        it('товар остался у покупателя (1, 5) → Rejected: заявочный класс, физики нет', () => {
            expect(wbClaimState(claim(1), false)).toBe('Rejected');
            expect(wbClaimState(claim(5), false)).toBe('Rejected');
        });

        it('в утиль (2) → Utilized: класс LOST, товар не доедет', () => {
            expect(wbClaimState(claim(2), true)).toBe('Utilized');
        });

        it('возврат в реализацию (8) → ReturnedToOzon: товар остаётся у ВБ — unretire + донор', () => {
            expect(wbClaimState(claim(8), true)).toBe('ReturnedToOzon');
        });

        it('возврат продавцу (10): активная — едет, архивная — доехала', () => {
            expect(wbClaimState(claim(10), false)).toBe('MovingToSeller');
            expect(wbClaimState(claim(10), true)).toBe('ReceivedBySeller');
        });

        it('неизвестный status_ex → unknown (письмо «разобрать руками»)', () => {
            expect(wbClaimState(claim(99), false)).toBe('unknown');
        });
    });
});
