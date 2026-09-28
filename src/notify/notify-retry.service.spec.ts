import { NotifyRetryService } from './notify-retry.service';

describe('NotifyRetryService', () => {
    const store = new Map<string, any>();
    const cache = {
        get: jest.fn(async (k: string) => store.get(k)),
        set: jest.fn(async (k: string, v: any) => void store.set(k, v)),
        del: jest.fn(async (k: string) => void store.delete(k)),
    };
    const matrix = { deliver: jest.fn() };
    const mail = { send: jest.fn().mockResolvedValue(true) };
    const routes = { targets: jest.fn().mockResolvedValue(['dev@x.y']) };
    const config = { get: jest.fn((k: string) => ({ INSTANCE: 'opt' })[k]) };
    let service: NotifyRetryService;

    beforeEach(() => {
        store.clear();
        matrix.deliver.mockReset();
        mail.send.mockClear();
        service = new NotifyRetryService(cache as any, matrix as any, mail as any, routes as any, config as any);
    });

    it('enqueue → retry по порядку, первая неудача оставляет хвост', async () => {
        await service.enqueue('!a:s', { subject: 'один', text: '1' });
        await service.enqueue('!b:s', { subject: 'два', text: '2' });
        await service.enqueue('!c:s', { subject: 'три', text: '3' });
        matrix.deliver.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 502 });
        expect(await service.retry()).toEqual({ sent: 1, dropped: 0, left: 2 });
        expect(matrix.deliver.mock.calls[0][1].subject).toMatch(/^\(с \d\d:\d\d, доставлено с задержкой\) один$/);
        expect(await service.size()).toBe(2);
        // следующий проход доставляет остаток
        matrix.deliver.mockResolvedValue({ ok: true });
        expect(await service.retry()).toEqual({ sent: 2, dropped: 0, left: 0 });
        expect(store.has(NotifyRetryService.KEY)).toBe(false);
    });

    it('просроченное выбрасывается', async () => {
        store.set(
            NotifyRetryService.KEY,
            JSON.stringify([{ ts: Date.now() - 25 * 3600_000, room: '!a:s', message: { subject: 's', text: 't' } }]),
        );
        expect(await service.retry()).toEqual({ sent: 0, dropped: 1, left: 0 });
        expect(matrix.deliver).not.toHaveBeenCalled();
    });

    it('письмо «Matrix недоступен» — одно после 10 минут, сброс при восстановлении', async () => {
        store.set(NotifyRetryService.DOWN_SINCE_KEY, Date.now() - 11 * 60_000);
        await service.enqueue('!a:s', { subject: 's', text: 't' });
        await service.enqueue('!a:s', { subject: 's2', text: 't' });
        expect(mail.send).toHaveBeenCalledTimes(1);
        expect(mail.send.mock.calls[0][0]).toBe('dev@x.y');
        expect(mail.send.mock.calls[0][1].subject).toBe('[опт] Matrix недоступен');
        matrix.deliver.mockResolvedValue({ ok: true });
        await service.retry();
        expect(store.has(NotifyRetryService.DOWN_ALERTED_KEY)).toBe(false);
    });
});
