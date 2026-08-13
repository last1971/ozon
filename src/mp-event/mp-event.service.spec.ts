import { Test, TestingModule } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { MpEventService, MpEventDto } from './mp-event.service';
import { FIREBIRD } from '../firebird/firebird.module';

describe('MpEventService', () => {
    let service: MpEventService;
    const query = jest.fn();
    const execute = jest.fn();
    const commit = jest.fn();
    const rollback = jest.fn();
    const transaction = { query, execute, commit, rollback };
    const event: MpEventDto = {
        service: 'OZON',
        kind: 'RETURN',
        extId: '1003975443',
        state: 'ReturnedToOzon',
        posting: '0103410090-0102-1',
    };

    beforeEach(async () => {
        [query, execute, commit, rollback].forEach((m) => m.mockReset());
        commit.mockResolvedValue(undefined);
        rollback.mockResolvedValue(undefined);
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MpEventService,
                { provide: FIREBIRD, useValue: { getTransaction: async () => transaction } },
            ],
        }).compile();
        service = module.get(MpEventService);
    });

    describe('record', () => {
        it('новое событие → INSERT и true', async () => {
            query.mockResolvedValueOnce([]);
            await expect(service.record(event)).resolves.toBe(true);
            expect(execute.mock.calls[0][0]).toContain('INSERT INTO MP_EVENT');
            expect(execute.mock.calls[0][1].slice(0, 4)).toEqual([
                'OZON',
                'RETURN',
                '1003975443',
                'ReturnedToOzon',
            ]);
            expect(commit).toHaveBeenCalled();
        });

        it('знакомое событие → двигаем LAST_SEEN и false', async () => {
            query.mockResolvedValueOnce([{ HANDLED_AT: null }]);
            await expect(service.record(event)).resolves.toBe(false);
            expect(execute.mock.calls[0][0]).toContain('UPDATE MP_EVENT SET LAST_SEEN');
        });

        it('состояние входит в ключ: смена состояния — другое событие', async () => {
            query.mockResolvedValueOnce([]);
            await service.record({ ...event, state: 'MovingToOzon' });
            const key = execute.mock.calls[0][1].slice(0, 4);
            expect(key[3]).toBe('MovingToOzon');
        });
    });

    describe('isHandled / markHandled', () => {
        it('HANDLED_AT пуст → не обработано, следующий проход возьмёт снова', async () => {
            query.mockResolvedValueOnce([{ HANDLED_AT: null }]);
            await expect(service.isHandled(event)).resolves.toBe(false);
        });

        it('HANDLED_AT стоит → обработано', async () => {
            query.mockResolvedValueOnce([{ HANDLED_AT: new Date() }]);
            await expect(service.isHandled(event)).resolves.toBe(true);
        });

        it('markHandled ставит отметку только необработанному', async () => {
            await service.markHandled(event);
            expect(execute.mock.calls[0][0]).toContain('HANDLED_AT IS NULL');
        });
    });

    describe('hasAnyState', () => {
        it('есть запись о delivering → true, состояния уходят в IN', async () => {
            query.mockResolvedValueOnce([{ STATE: 'delivering' }]);
            await expect(
                service.hasAnyState('OZON', 'POSTING_FBS', '0267983325-0001-3', ['delivering', 'delivered']),
            ).resolves.toBe(true);
            expect(query.mock.calls[0][0]).toContain('STATE IN (?, ?)');
            expect(query.mock.calls[0][1]).toEqual([
                'OZON',
                'POSTING_FBS',
                '0267983325-0001-3',
                'delivering',
                'delivered',
            ]);
        });

        it('записи нет → false', async () => {
            query.mockResolvedValueOnce([]);
            await expect(service.hasAnyState('OZON', 'POSTING_FBS', '1', ['delivering'])).resolves.toBe(false);
        });

        it('пустой список состояний → false без запроса', async () => {
            await expect(service.hasAnyState('OZON', 'POSTING_FBS', '1', [])).resolves.toBe(false);
            expect(query).not.toHaveBeenCalled();
        });
    });

    describe('listUnhandled / listStatesForPosting (напоминалка CANCEL_WAIT)', () => {
        it('listUnhandled отдаёт неразобранные события потока', async () => {
            query.mockResolvedValueOnce([{ EXT_ID: '456', POSTING: '456', FIRST_SEEN: '2026-08-05T00:00:00' }]);
            const rows = await service.listUnhandled('OZON', 'CANCEL_WAIT');
            expect(query.mock.calls[0][0]).toContain('HANDLED_AT IS NULL');
            expect(rows).toEqual([{ extId: '456', posting: '456', firstSeen: new Date('2026-08-05T00:00:00') }]);
        });

        it('listUnhandled с состоянием фильтрует по STATE (добор доставленного)', async () => {
            query.mockResolvedValueOnce([{ EXT_ID: '789-1', POSTING: '789-1', FIRST_SEEN: '2026-07-20T00:00:00' }]);
            const rows = await service.listUnhandled('OZON', 'POSTING_FBS', 'delivered');
            expect(query.mock.calls[0][0]).toContain('AND STATE = ?');
            expect(query.mock.calls[0][1]).toEqual(['OZON', 'POSTING_FBS', 'delivered']);
            expect(rows[0].extId).toBe('789-1');
        });

        it('listStatesForPosting ищет по номеру отправления и отдаёт состояния', async () => {
            query.mockResolvedValueOnce([{ STATE: 'MovingToOzon' }, { STATE: 'Utilized' }]);
            await expect(service.listStatesForPosting('OZON', 'RETURN', '456')).resolves.toEqual([
                'MovingToOzon',
                'Utilized',
            ]);
            expect(query.mock.calls[0][0]).toContain('POSTING = ?');
            expect(query.mock.calls[0][1]).toEqual(['OZON', 'RETURN', '456']);
        });
    });

    describe('windowStart', () => {
        it('журнал пуст → холодный старт по дефолтному окну', async () => {
            query.mockResolvedValueOnce([{ LAST_SEEN: null }]);
            const from = await service.windowStart('OZON', 'POSTING_FBS', 45, 2);
            expect(DateTime.fromJSDate(from).toISODate()).toBe(
                DateTime.now().minus({ day: 45 }).startOf('day').toISODate(),
            );
        });

        it('в журнале есть события → окно от последнего минус нахлёст', async () => {
            const lastSeen = DateTime.now().minus({ hour: 3 }).toJSDate();
            query.mockResolvedValueOnce([{ LAST_SEEN: lastSeen }]);
            const from = await service.windowStart('OZON', 'RETURN', 45, 2);
            expect(DateTime.fromJSDate(from).toISO()).toBe(
                DateTime.fromJSDate(lastSeen).minus({ day: 2 }).toISO(),
            );
        });

        it('простой дольше дефолтного окна → берём журнал, а не «сейчас минус N»', async () => {
            // сервис стоял 100 дней; «сейчас минус 45» проглотило бы 55 дней событий молча
            const lastSeen = DateTime.now().minus({ day: 100 }).toJSDate();
            query.mockResolvedValueOnce([{ LAST_SEEN: lastSeen }]);
            const from = await service.windowStart('OZON', 'POSTING_FBS', 45, 2);
            expect(DateTime.fromJSDate(from) < DateTime.now().minus({ day: 45 })).toBe(true);
        });

        it('максимум берётся по паре (SERVICE, KIND), а не общий', async () => {
            query.mockResolvedValueOnce([{ LAST_SEEN: null }]);
            await service.windowStart('OZON', 'POSTING_FBO', 90, 1);
            expect(query.mock.calls[0][0]).toContain('WHERE SERVICE = ? AND KIND = ?');
            expect(query.mock.calls[0][1]).toEqual(['OZON', 'POSTING_FBO']);
        });
    });
});
