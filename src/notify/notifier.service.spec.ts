import { NotifierService } from './notifier.service';
import { NotifyTopic } from './notify.types';

function make(env: Record<string, string>, routes: Record<string, string[]>) {
    const mail = { channel: 'mail' as const, send: jest.fn().mockResolvedValue(true) };
    const matrix = { channel: 'matrix' as const, send: jest.fn().mockResolvedValue(true), deliver: jest.fn() };
    const repo = {
        targets: jest.fn(async (topic: string, channel: string) => routes[`${topic}:${channel}`] ?? []),
        hasRoutes: jest.fn(async (topic: string) => Object.keys(routes).some((k) => k.startsWith(`${topic}:`))),
    };
    const retry = { enqueue: jest.fn() };
    const store = new Map<string, any>();
    const cache = {
        get: jest.fn(async (k: string) => store.get(k)),
        set: jest.fn(async (k: string, v: any) => void store.set(k, v)),
        del: jest.fn(),
    };
    const config = { get: jest.fn((k: string) => env[k]) };
    const service = new NotifierService([mail, matrix], repo as any, retry as any, matrix as any, cache as any, config as any);
    return { service, mail, matrix, repo, retry };
}

describe('NotifierService', () => {
    const prod = { NODE_ENV: 'production', INSTANCE: 'opt' };

    it('тема → все адресаты по каналам, тег в заголовке, m.text для OPS', async () => {
        const { service, mail, matrix } = make(prod, { 'OPS:mail': ['a@b.c'], 'OPS:matrix': ['!r1:s', '!r2:s'] });
        await service.errorMessage('Разобрать посылку', 'текст', NotifyTopic.OPS);
        expect(mail.send).toHaveBeenCalledWith('a@b.c', expect.objectContaining({ subject: '[опт] Разобрать посылку', notice: false }));
        expect(matrix.send).toHaveBeenCalledTimes(2);
        expect(matrix.send.mock.calls[1][0]).toBe('!r2:s');
    });

    it('error.message без темы → DEV, m.notice; повтор того же текста за 30 мин не шлётся', async () => {
        const { service, matrix } = make(prod, { 'DEV:matrix': ['!dev:s'] });
        await service.errorMessage('Сбои в прогоне', 'x');
        await service.errorMessage('Сбои в прогоне', 'x');
        await service.errorMessage('Сбои в прогоне', 'y');
        expect(matrix.send).toHaveBeenCalledTimes(2);
        expect(matrix.send.mock.calls[0][1].notice).toBe(true);
    });

    it('OPS без дедупа: одинаковые сообщения уходят оба', async () => {
        const { service, matrix } = make(prod, { 'OPS:matrix': ['!r:s'] });
        await service.errorMessage('s', 'x', NotifyTopic.OPS);
        await service.errorMessage('s', 'x', NotifyTopic.OPS);
        expect(matrix.send).toHaveBeenCalledTimes(2);
    });

    it('тема без маршрутов → false, транспорты не трогаются', async () => {
        const { service, mail, matrix } = make(prod, {});
        expect(await service.errorMessage('s', 'x', NotifyTopic.FINANCE)).toBe(false);
        expect(mail.send).not.toHaveBeenCalled();
        expect(matrix.send).not.toHaveBeenCalled();
    });

    it('DEV без маршрутов не ставит дедуп: после появления маршрута то же сообщение уходит', async () => {
        const routes: Record<string, string[]> = {};
        const { service, matrix } = make(prod, routes);
        expect(await service.errorMessage('s', 'x')).toBe(false);
        routes['DEV:matrix'] = ['!d:s'];
        expect(await service.errorMessage('s', 'x')).toBe(true);
        expect(matrix.send).toHaveBeenCalledTimes(1);
    });

    it('не production: транспорты не вызываются, но результат true', async () => {
        const { service, mail, matrix } = make({ NODE_ENV: 'development', FB_BASE: '/var/db/magazin.fdb' }, { 'OPS:mail': ['a@b.c'] });
        expect(await service.errorMessage('s', 'x', NotifyTopic.OPS)).toBe(true);
        expect(mail.send).not.toHaveBeenCalled();
        expect(matrix.send).not.toHaveBeenCalled();
    });

    it('неудача matrix → в очередь повтора; неудача mail — нет', async () => {
        const { service, mail, matrix, retry } = make(prod, { 'MARKING:matrix': ['!m:s'], 'MARKING:mail': ['a@b.c'] });
        matrix.send.mockResolvedValue(false);
        mail.send.mockResolvedValue(false);
        expect(await service.errorMessage('s', 'x', NotifyTopic.MARKING)).toBe(false);
        expect(retry.enqueue).toHaveBeenCalledWith('!m:s', expect.objectContaining({ subject: '[опт] s' }));
        expect(retry.enqueue).toHaveBeenCalledTimes(1);
    });

    it('структурные события идут в PRICES/OPS с hbs-шаблоном и plain-текстом', async () => {
        const { service, mail, matrix } = make(prod, { 'PRICES:mail': ['n@x.y'], 'OPS:matrix': ['!o:s'] });
        await service.halfStore({ name: 'Резистор', quantity: 3, reserve: 1 }, { AMOUNT: 40 });
        expect(mail.send.mock.calls[0][1]).toMatchObject({ mail: { template: 'half_store' }, text: expect.stringContaining('Резистор') });
        await service.wbOrders('Добавлены WB FBO заказы', [{ prim: 'srid1', offer_id: 'ART' }]);
        expect(matrix.send.mock.calls[0][1]).toMatchObject({ notice: true, text: 'srid1 — ART' });
    });

    it('отчёт о ценах: цвет и знак по стороне разницы', async () => {
        const { service, mail, matrix } = make(prod, { 'PRICES:mail': ['n@x.y'], 'PRICES:matrix': ['!p:s'] });
        await service.problematicPrices({
            thresholdPercent: 5,
            products: [
                { offer_id: 'A', name: 'a', marketing_seller_price: 110, min_price: 100, diffPercent: 10 },
                { offer_id: 'B', name: 'b', marketing_seller_price: 93, min_price: 100, diffPercent: -7 },
            ],
        });
        const rows = mail.send.mock.calls[0][1].mail.context.products;
        expect(rows.map((r: any) => [r.diffLabel, r.rowColor])).toEqual([
            ['+10', '#e3f4e1'],
            ['−7', '#fbe3e3'],
        ]);
        const text = matrix.send.mock.calls[0][1].text;
        expect(text).toContain('🟢 +10% A');
        expect(text).toContain('🔴 −7% B');
    });

    it('test с явной комнатой — напрямую через deliver, мимо таблицы', async () => {
        const { service, matrix, repo } = make({ NODE_ENV: 'development', INSTANCE: 'shop' }, {});
        matrix.deliver.mockResolvedValue({ ok: true });
        expect(await service.test(NotifyTopic.DEV, '!x:s')).toEqual({ ok: true, detail: 'в комнате' });
        expect(matrix.deliver.mock.calls[0][1].subject).toBe('[розница] Проверка темы DEV');
        expect(repo.targets).not.toHaveBeenCalled();
    });

    it('test без комнаты идёт по теме, тег ставится один раз', async () => {
        const { service, matrix } = make(prod, { 'DEV:matrix': ['!d:s'] });
        expect(await service.test(NotifyTopic.DEV)).toEqual({ ok: true });
        expect(matrix.send.mock.calls[0][1].subject).toBe('[опт] Проверка темы DEV');
    });
});
