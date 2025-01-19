import { Test, TestingModule } from '@nestjs/testing';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';

describe('PromosController', () => {
    let controller: PromosController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PromosController],
            providers: [
                {
                    provide: PromosService,
                    useValue: {}, // mock PromosService
                },
            ],
        }).compile();

        controller = module.get<PromosController>(PromosController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
