import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceController } from './invoice.controller';
import { IsRemarkValid } from "../validators/is.remark.valid";
import { IInvoice, INVOICE_SERVICE } from "../interfaces/IInvoice";

describe('InvoiceController', () => {
    let controller: InvoiceController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [{
                provide: IsRemarkValid,
                useValue: {},
            }, {
                provide: INVOICE_SERVICE,
                useValue: {},
            }],
            controllers: [InvoiceController],
        }).compile();

        controller = module.get<InvoiceController>(InvoiceController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
