import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FboSalesObserverService } from './fbo-sales-observer.service';
import { MpDecisionRunnerService } from '../mp-decision/mp-decision.runner.service';
import { PostingFboService } from '../posting.fbo/posting.fbo.service';
import { WbOrderService } from '../wb.order/wb.order.service';

describe('FboSalesObserverService — наблюдатель FBO-продаж (Ozon и ВБ)', () => {
    let service: FboSalesObserverService;
    const ozonDelivered = jest.fn();
    const wbDelivered = jest.fn();
    const ingestDelivered = jest.fn();
    const drainDelivered = jest.fn();
    const flush = jest.fn();
    let services: string[] = ['ozon', 'wb'];

    beforeEach(async () => {
        [ozonDelivered, wbDelivered, ingestDelivered, drainDelivered, flush].forEach((m) => m.mockReset());
        ozonDelivered.mockResolvedValue([]);
        wbDelivered.mockResolvedValue([]);
        ingestDelivered.mockResolvedValue(true);
        services = ['ozon', 'wb'];
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FboSalesObserverService,
                {
                    provide: ConfigService,
                    useValue: { get: (key: string, def?: unknown) => (key === 'SERVICES' ? services : def) },
                },
                { provide: MpDecisionRunnerService, useValue: { ingestDelivered, drainDelivered, flush } },
                { provide: PostingFboService, useValue: { listDeliveredFbo: ozonDelivered } },
                { provide: WbOrderService, useValue: { listDeliveredFbo: wbDelivered } },
            ],
        }).compile();
        service = module.get(FboSalesObserverService);
    });

    it('доставленные FBO обеих площадок → общая цепочка runner (журнал POSTING_FBO/delivered + добор), flush в конце', async () => {
        ozonDelivered.mockResolvedValue(['O-1', 'O-2']);
        wbDelivered.mockResolvedValue(['srid-1']);

        await service.observeFboSales();

        expect(ingestDelivered).toHaveBeenCalledTimes(3);
        expect(ingestDelivered).toHaveBeenCalledWith({
            service: 'OZON',
            kind: 'POSTING_FBO',
            extId: 'O-1',
            state: 'delivered',
            posting: 'O-1',
        });
        expect(ingestDelivered).toHaveBeenCalledWith({
            service: 'WB',
            kind: 'POSTING_FBO',
            extId: 'srid-1',
            state: 'delivered',
            posting: 'srid-1',
        });
        expect(drainDelivered).toHaveBeenCalledWith('OZON', 'POSTING_FBO');
        expect(drainDelivered).toHaveBeenCalledWith('WB', 'POSTING_FBO');
        expect(flush).toHaveBeenCalledWith('observeFboSales');
    });

    it('площадка не включена в SERVICES — к ней не ходим', async () => {
        services = ['ozon'];

        await service.observeFboSales();

        expect(ozonDelivered).toHaveBeenCalled();
        expect(wbDelivered).not.toHaveBeenCalled();
        expect(drainDelivered).toHaveBeenCalledTimes(1);
    });

    it('сбой API одной площадки не роняет другую и не мешает flush', async () => {
        ozonDelivered.mockRejectedValue(new Error('ozon down'));
        wbDelivered.mockResolvedValue(['srid-1']);

        await service.observeFboSales();

        expect(ingestDelivered).toHaveBeenCalledTimes(1);
        expect(drainDelivered).toHaveBeenCalledWith('WB', 'POSTING_FBO');
        expect(drainDelivered).not.toHaveBeenCalledWith('OZON', 'POSTING_FBO');
        expect(flush).toHaveBeenCalled();
    });
});
