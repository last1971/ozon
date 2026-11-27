import { Test, TestingModule } from '@nestjs/testing';
import { OzonPromosApi } from './promos.api';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';
import { PromoPriceService } from './price-lever/promo-price.service';
import { PromoSweepService } from './price-lever/sweep/promo-sweep.service';

describe('PromosController', () => {
    let controller: PromosController;
    const page = jest.fn();
    const states = jest.fn();
    const plans = jest.fn();
    const apply = jest.fn();
    const sweepStart = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PromosController],
            providers: [
                { provide: PromosService, useValue: {} },
                { provide: OzonPromosApi, useValue: { page } },
                { provide: PromoPriceService, useValue: { states, plans, apply } },
                { provide: PromoSweepService, useValue: { start: sweepStart } },
            ],
        }).compile();
        controller = module.get(PromosController);
    });

    it('страницы участников и кандидатов отдаются из шлюза с last_id', async () => {
        page.mockResolvedValue({ products: [], total: 0, lastId: '' });
        await controller.actionsProducts({ action_id: 1, last_id: '9' });
        expect(page).toHaveBeenCalledWith('products', 1, '9');
        await controller.actionsCandidates({ action_id: 1 });
        expect(page).toHaveBeenCalledWith('candidates', 1, undefined);
    });

    it('price-plan: артикулы в сервис', async () => {
        plans.mockResolvedValue([]);
        await controller.pricePlan({ offer_ids: ['383367'] });
        expect(plans).toHaveBeenCalledWith(['383367']);
    });

    it('price-state: артикулы в сервис', async () => {
        states.mockResolvedValue([]);
        await controller.priceState({ offer_ids: ['383367'] });
        expect(states).toHaveBeenCalledWith(['383367']);
    });

    it('price-apply: артикулы в сервис', async () => {
        apply.mockResolvedValue([]);
        await controller.priceApply({ offer_ids: ['532100'] });
        expect(apply).toHaveBeenCalledWith(['532100']);
    });

    it('promo-sweep: без apply — только отчёт, без цели — «ниже минимальной»; метка браузера в задачу', () => {
        sweepStart.mockReturnValue({ id: 'j' });
        expect(controller.promoSweep(undefined, undefined, 'cid')).toEqual({ id: 'j' });
        expect(sweepStart).toHaveBeenCalledWith(false, 'below-min', 'cid');
        controller.promoSweep(true, 'min', '');
        expect(sweepStart).toHaveBeenLastCalledWith(true, 'min', undefined);
    });
});
