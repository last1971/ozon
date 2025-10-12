import { Test, TestingModule } from '@nestjs/testing';
import { FetchInvoiceByRemarkCommand } from './fetch-invoice-by-remark.command';
import { INVOICE_SERVICE } from '../../interfaces/IInvoice';
import { IWbTransactionProcessingContext } from '../../interfaces/i.wb.transaction.processing.context';
import { InvoiceDto } from '../../invoice/dto/invoice.dto';

describe('FetchInvoiceByRemarkCommand', () => {
    let command: FetchInvoiceByRemarkCommand;
    const getByPosting = jest.fn();

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FetchInvoiceByRemarkCommand,
                {
                    provide: INVOICE_SERVICE,
                    useValue: { getByPosting },
                },
            ],
        }).compile();

        getByPosting.mockClear();
        command = module.get<FetchInvoiceByRemarkCommand>(FetchInvoiceByRemarkCommand);
    });

    it('should be defined', () => {
        expect(command).toBeDefined();
    });

    it('should stop chain if no selectedId', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
        };

        const result = await command.execute(context);

        expect(getByPosting).not.toHaveBeenCalled();
        expect(result).toEqual({
            ...context,
            stopChain: true,
        });
    });

    it('should fetch invoice by assembly_id', async () => {
        const mockInvoice: InvoiceDto = {
            id: 123,
            buyerId: 456,
            number: 1,
            status: 1,
            remark: 'WB 5001',
            date: new Date(),
        };

        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
            selectedId: '5001',
            selectedIdType: 'assembly_id',
        };

        getByPosting.mockResolvedValueOnce(mockInvoice);

        const result = await command.execute(context);

        expect(getByPosting).toHaveBeenCalledWith('5001', null, true);
        expect(result).toEqual({
            ...context,
            invoice: mockInvoice,
        });
    });

    it('should fetch invoice by srid', async () => {
        const mockInvoice: InvoiceDto = {
            id: 123,
            buyerId: 456,
            number: 1,
            status: 1,
            remark: 'WB SRID123',
            date: new Date(),
        };

        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
            selectedId: 'SRID123',
            selectedIdType: 'srid',
        };

        getByPosting.mockResolvedValueOnce(mockInvoice);

        const result = await command.execute(context);

        expect(getByPosting).toHaveBeenCalledWith('SRID123', null, true);
        expect(result).toEqual({
            ...context,
            invoice: mockInvoice,
        });
    });

    it('should return context with null invoice if not found', async () => {
        const context: IWbTransactionProcessingContext = {
            dateFrom: new Date('2025-09-21'),
            stickerId: '42197484529',
            srid: 'SRID123',
            selectedId: 'SRID999',
            selectedIdType: 'srid',
        };

        getByPosting.mockResolvedValueOnce(null);

        const result = await command.execute(context);

        expect(getByPosting).toHaveBeenCalledWith('SRID999', null, true);
        expect(result).toEqual({
            ...context,
            invoice: null,
        });
    });
});
