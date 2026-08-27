import { Test, TestingModule } from '@nestjs/testing';
import { AvitoLinkMaintenanceService } from './avito.link.maintenance.service';
import { AvitoApiService } from '../avito.api/avito.api.service';
import { AVITO_GOOD_STORE } from '../interfaces/i.avito.good.store';
import { AvitoItemStatus } from '../avito.api/avito.item.status';

describe('AvitoLinkMaintenanceService', () => {
    let service: AvitoLinkMaintenanceService;
    let api: jest.Mocked<AvitoApiService>;
    let store: any;

    const link = (id: string) => ({ id, goodsCode: `goods${id}`, coeff: 1, commission: 10 });

    beforeEach(async () => {
        const mockApi = { getItemStatus: jest.fn() };
        const mockStore = { disableAvitoGoods: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AvitoLinkMaintenanceService,
                { provide: AvitoApiService, useValue: mockApi },
                { provide: AVITO_GOOD_STORE, useValue: mockStore },
            ],
        }).compile();

        service = module.get(AvitoLinkMaintenanceService);
        api = module.get(AvitoApiService);
        store = module.get(AVITO_GOOD_STORE);
    });

    it('отключает привязку при статусе removed, id уходит строкой', async () => {
        api.getItemStatus.mockResolvedValue({ kind: 'status', status: AvitoItemStatus.Removed });

        const disabled = await service.disableDeadLinks([link('7919159836')]);

        expect(store.disableAvitoGoods).toHaveBeenCalledWith(['7919159836'], AvitoItemStatus.Removed);
        expect(disabled).toEqual(['7919159836']);
    });

    it.each([
        ['архивное', { kind: 'status', status: AvitoItemStatus.Old }],
        ['отклонённое', { kind: 'status', status: AvitoItemStatus.Rejected }],
        ['заблокированное', { kind: 'status', status: AvitoItemStatus.Blocked }],
        ['неизвестный статус', { kind: 'unknown-status', raw: 'archived' }],
        ['статус не получен', { kind: 'unreachable', message: 'ECONNRESET' }],
    ])('не трогает привязку: %s', async (_name, probe) => {
        api.getItemStatus.mockResolvedValue(probe as any);

        const disabled = await service.disableDeadLinks([link('123')]);

        expect(store.disableAvitoGoods).not.toHaveBeenCalled();
        expect(disabled).toEqual([]);
    });

    it('в одной пачке отключает только мёртвых', async () => {
        api.getItemStatus
            .mockResolvedValueOnce({ kind: 'status', status: AvitoItemStatus.Removed })
            .mockResolvedValueOnce({ kind: 'status', status: AvitoItemStatus.Old })
            .mockResolvedValueOnce({ kind: 'status', status: AvitoItemStatus.Removed });

        await service.disableDeadLinks([link('1'), link('2'), link('3')]);

        expect(store.disableAvitoGoods).toHaveBeenCalledTimes(1);
        expect(store.disableAvitoGoods).toHaveBeenCalledWith(['1', '3'], AvitoItemStatus.Removed);
    });

    it('на пустом списке в справочник не ходит', async () => {
        await service.disableDeadLinks([]);

        expect(api.getItemStatus).not.toHaveBeenCalled();
        expect(store.disableAvitoGoods).not.toHaveBeenCalled();
    });
});
