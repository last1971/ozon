import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Workbook } from 'exceljs';
import { Trade2006ChzService } from '../trade2006.chz/trade2006.chz.service';
import { ChzService } from './chz.service';

describe('ChzService', () => {
    let service: ChzService;
    const pending = jest.fn();
    const pendingDocs = jest.fn();
    const createBatch = jest.fn();
    const createDocBatch = jest.fn();
    const getBatch = jest.fn();
    const confirmBatch = jest.fn();
    const listBatches = jest.fn();
    const emit = jest.fn();

    beforeEach(async () => {
        [pending, pendingDocs, createBatch, createDocBatch, getBatch, confirmBatch, listBatches, emit].forEach((m) =>
            m.mockReset(),
        );
        pending.mockResolvedValue([]);
        pendingDocs.mockResolvedValue([]);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChzService,
                {
                    provide: Trade2006ChzService,
                    useValue: {
                        pending,
                        pendingDocs,
                        createBatch,
                        createDocBatch,
                        getBatch,
                        confirmBatch,
                        listBatches,
                    },
                },
                { provide: EventEmitter2, useValue: { emit } },
                { provide: ConfigService, useValue: { get: () => 'true' } },
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

    it('напоминалка: одно письмо — сколько КИ и по скольким счетам ждут вывода и возврата', async () => {
        pending.mockImplementation((kind: string) =>
            Promise.resolve(
                kind === 'retire'
                    ? [
                          { ki: 'KI-1', invoiceNumber: 15023 },
                          { ki: 'KI-2', invoiceNumber: 15023 },
                          { ki: 'KI-4', invoiceNumber: 15024 },
                      ]
                    : [
                          { ki: 'KI-3', invoiceNumber: 19428 },
                          { ki: 'KI-5', invoiceNumber: null },
                      ],
            ),
        );
        await service.reminder();
        expect(emit).toHaveBeenCalledTimes(1);
        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toBe('ЧЗ: ждут вывода 3 КИ, возврата 2 КИ');
        expect(body).toContain('Вывести из оборота: 3 КИ, счетов 2.');
        expect(body).toContain('Вернуть в оборот: 2 КИ, счетов 1, без счёта 1.');
        expect(body).toContain('страница «Отправка в Честный знак»');
    });

    it('напоминалка: выгрузка руками — подсказка про вкладку «ЧЗ»', () => {
        const letter = ChzService.reminderLetter([{ ki: 'KI-1', invoiceNumber: 1 } as any], [], [], false);
        expect(letter.subject).toBe('ЧЗ: ждут вывода 1 КИ');
        expect(letter.body).toContain('вкладка «ЧЗ»');
    });

    it('batchFile: пачка по УПД — в имени номер и дата документа', async () => {
        getBatch.mockResolvedValue({
            info: {
                id: 12,
                kind: 'retire_upd',
                createdAt: new Date(),
                confirmedAt: null,
                cnt: 1,
                sfcode: 97542,
                nsf: 6558,
                date: new Date('2026-08-02T00:00:00'),
            },
            codes: [{ ki: 'KI-1', price: 100 }],
        });
        // по номеру и дате владелец заполняет форму вывода в ГИС МТ
        expect((await service.batchFile(12)).filename).toBe('vyvod_UPD-6558_02.08.2026.xlsx');
    });

    it('batchFile: у пачки по УПД нет реквизитов → падаем на SFCODE, а не на пустое имя', async () => {
        getBatch.mockResolvedValue({
            info: {
                id: 13,
                kind: 'retire_upd',
                createdAt: new Date(),
                confirmedAt: null,
                cnt: 1,
                sfcode: 97542,
                nsf: null,
                date: null,
            },
            codes: [{ ki: 'KI-1', price: null }],
        });
        expect((await service.batchFile(13)).filename).toBe('vyvod_UPD-97542.xlsx');
    });

    it('createDocBatch: по УПД выводить нечего → null', async () => {
        createDocBatch.mockResolvedValue(null);
        expect(await service.createDocBatch(97542)).toBeNull();
    });

    it('напоминалка считает и коды УПД, и документы', async () => {
        pendingDocs.mockResolvedValue([
            { sfcode: 1, nsf: 10, date: null, buyer: 'ООО', cnt: 2, since: null },
            { sfcode: 2, nsf: 11, date: null, buyer: 'ИП', cnt: 3, since: null },
        ]);
        await service.reminder();
        const [, subject, body] = emit.mock.calls[0];
        expect(subject).toBe('ЧЗ: ждут вывода 5 КИ');
        expect(body).toContain('Вывести по УПД: 5 КИ, документов 2.');
    });

    it('createBatch: пусто → null (кнопке нечего скачивать)', async () => {
        createBatch.mockResolvedValue(null);
        expect(await service.createBatch('retire')).toBeNull();
    });
});
