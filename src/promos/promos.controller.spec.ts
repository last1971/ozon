import { Test, TestingModule } from '@nestjs/testing';
import { OzonPromosApi } from './promos.api';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';

describe('PromosController', () => {
    let controller: PromosController;
    const page = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PromosController],
            providers: [
                { provide: PromosService, useValue: {} },
                { provide: OzonPromosApi, useValue: { page } },
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
});
