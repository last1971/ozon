import { Test } from '@nestjs/testing';
import { INVOICE_SERVICE } from '../interfaces/IInvoice';
import { FboShortageCloser } from './fbo-shortage-closer';

describe('FboShortageCloser', () => {
    const t = {} as any;
    const closeFboShortage = jest.fn();
    const isInFboShortage = jest.fn();
    const getPrimContaining = jest.fn();
    const pickupFboUnlessShortage = jest.fn();
    let closer: FboShortageCloser;

    beforeEach(async () => {
        [closeFboShortage, isInFboShortage, getPrimContaining, pickupFboUnlessShortage].forEach((m) => m.mockReset());
        const module = await Test.createTestingModule({
            providers: [
                FboShortageCloser,
                {
                    provide: INVOICE_SERVICE,
                    useValue: { closeFboShortage, isInFboShortage, getPrimContaining, pickupFboUnlessShortage },
                },
            ],
        }).compile();
        closer = module.get(FboShortageCloser);
    });

    it('журнал закрыт по каждому товару; недобора не осталось → счёт в подбор', async () => {
        isInFboShortage.mockResolvedValue(false);
        getPrimContaining.mockResolvedValue([{ id: 7 }, { id: 500, remark: 'P-1' }]);
        const res = await closer.close(
            'P-1',
            500,
            new Map([
                ['444', 6],
                ['555', 2],
            ]),
            t,
        );
        expect(closeFboShortage).toHaveBeenCalledWith('P-1', '444', 6, t);
        expect(closeFboShortage).toHaveBeenCalledWith('P-1', '555', 2, t);
        expect(pickupFboUnlessShortage).toHaveBeenCalledWith({ id: 500, remark: 'P-1' }, t);
        expect(res).toEqual({ shortageClosed: true, pickedUp: true });
    });

    it('по другим позициям недобор открыт → в подбор не отдаём', async () => {
        isInFboShortage.mockResolvedValue(true);
        const res = await closer.close('P-1', 500, new Map([['444', 6]]), t);
        expect(getPrimContaining).not.toHaveBeenCalled();
        expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
        expect(res).toEqual({ shortageClosed: false, pickedUp: false });
    });

    it('счёт по отправлению не нашёлся → журнал закрыт, подбора нет', async () => {
        isInFboShortage.mockResolvedValue(false);
        getPrimContaining.mockResolvedValue([{ id: 7 }]);
        const res = await closer.close('P-1', 500, new Map([['444', 6]]), t);
        expect(pickupFboUnlessShortage).not.toHaveBeenCalled();
        expect(res).toEqual({ shortageClosed: true, pickedUp: false });
    });
});
