import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Workbook } from 'exceljs';
import { Trade2006ChzService } from '../trade2006.chz/trade2006.chz.service';
import { ChzService } from './chz.service';

describe('ChzService', () => {
    let service: ChzService;
    const pending = jest.fn();
    const createBatch = jest.fn();
    const getBatch = jest.fn();
    const confirmBatch = jest.fn();
    const listBatches = jest.fn();
    const emit = jest.fn();

    beforeEach(async () => {
        [pending, createBatch, getBatch, confirmBatch, listBatches, emit].forEach((m) => m.mockReset());
        pending.mockResolvedValue([]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChzService,
                { provide: Trade2006ChzService, useValue: { pending, createBatch, getBatch, confirmBatch, listBatches } },
                { provide: EventEmitter2, useValue: { emit } },
            ],
        }).compile();
        service = module.get(ChzService);
    });

    it('batchFile: xlsx формата ГИС МТ — КИ + цена строкой, БЕЗ заголовка', async () => {
        getBatch.mockResolvedValue({
            info: { id: 7, kind: 'retire', createdAt: new Date(), confirmedAt: null, cnt: 2 },
            codes: [
                { ki: 'KI-1', price: 1854 },
                { ki: 'KI-2', price: null },
            ],
        });
        const file = await service.batchFile(7);
        expect(file.filename).toBe('vyvod_iz_oborota_7.xlsx');

        const workbook = new Workbook();
        await workbook.xlsx.load(file.content as any);
        const sheet = workbook.worksheets[0];
        expect(sheet.rowCount).toBe(2); // без строки заголовка — ГИС МТ принял бы её за код
        expect(sheet.getRow(1).getCell(1).value).toBe('KI-1');
        expect(sheet.getRow(1).getCell(2).value).toBe('1854.00');
        expect(sheet.getRow(2).getCell(1).value).toBe('KI-2');
    });

    it('batchFile: возвратная пачка получает своё имя', async () => {
        getBatch.mockResolvedValue({
            info: { id: 8, kind: 'return', createdAt: new Date(), confirmedAt: null, cnt: 1 },
            codes: [{ ki: 'KI-1', price: null }],
        });
        expect((await service.batchFile(8)).filename).toBe('vozvrat_v_oborot_8.xlsx');
    });

    it('batchFile: пачки нет → null', async () => {
        getBatch.mockResolvedValue(null);
        expect(await service.batchFile(99)).toBeNull();
    });

    it('напоминалка молчит, когда передавать нечего', async () => {
        await service.reminder();
        expect(emit).not.toHaveBeenCalled();
    });

    it('напоминалка: счётчики обоих видов и отсылка к вкладке «ЧЗ»', async () => {
        pending.mockImplementation((kind: string) =>
            Promise.resolve(kind === 'retire' ? [{ ki: 'KI-1' }, { ki: 'KI-2' }] : [{ ki: 'KI-3' }]),
        );
        await service.reminder();
        expect(emit).toHaveBeenCalledTimes(1);
        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toContain('ЧЗ: ждёт передачи 3 КИ');
        expect(body).toContain('Вывести из оборота: 2 КИ');
        expect(body).toContain('Вернуть в оборот: 1 КИ');
        expect(body).toContain('вкладка «ЧЗ»');
    });

    it('createBatch: пусто → null (кнопке нечего скачивать)', async () => {
        createBatch.mockResolvedValue(null);
        expect(await service.createBatch('retire')).toBeNull();
    });
});
