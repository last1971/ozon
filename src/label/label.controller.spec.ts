import { Test, TestingModule } from '@nestjs/testing';
import { LabelController } from './label.controller';
import { LabelService } from "./label.service";

describe('LabelController', () => {
    let controller: LabelController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [LabelService],
            controllers: [LabelController],
        }).compile();

        controller = module.get<LabelController>(LabelController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
