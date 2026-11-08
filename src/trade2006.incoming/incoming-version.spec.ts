import { MpEventService } from '../mp-event/mp-event.service';
import { MarkIncomingHandledCommand } from './commands/mark-incoming-handled.command';
import { RepriceIncomingGoodsCommand } from './commands/reprice-incoming-goods.command';
const event = { service: 'TRADE' as const, kind: 'INCOMING' as const, extId: '1', state: 'pending' };
const context = () => ({
    settledMinutes: 15,
    prihods: [{ np: '1', firstSeen: new Date(), version: '2026-11-08 10:00:00.1234' }],
    skus: ['123'],
    goodsByPrihod: new Map([['1', ['123']]]),
});
function journal(version = '2026-11-08 10:00:00.1234') {
    const tx = {
        query: jest.fn(async (_sql: string, _params?: any[], _commit?: boolean) => [{ EVENT_VERSION: version }]),
        execute: jest.fn(async (_sql: string, _params?: any[], _commit?: boolean) => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
    };
    return { service: new MpEventService({ getTransaction: async () => tx } as any), tx };
}
it('фиксируется только точная версия документа, включая доли секунды', async () => {
    const s = journal();
    expect(
        await s.service.finishVersion(event, context().prihods[0].version, { incoming: { pending: [] } }, true),
    ).toBe(true);
    expect(s.tx.query.mock.calls[0][0]).toContain('WITH LOCK');
    expect(s.tx.execute.mock.calls[0][0]).toContain('HANDLED_AT = CURRENT_TIMESTAMP');
    expect(s.tx.execute.mock.calls[0][1].slice(-1)[0]).toBe('2026-11-08 10:00:00.1234');
});
it('приход изменился: ни диагностика старой версии, ни HANDLED_AT не записываются', async () => {
    const s = journal('2026-11-08 10:00:00.1235');
    expect(await s.service.finishVersion(event, context().prihods[0].version, {}, true)).toBe(false);
    expect(s.tx.execute).not.toHaveBeenCalled();
});
it('неуспех сохраняет причину, но не выставляет HANDLED_AT', async () => {
    const s = journal();
    const command = new MarkIncomingHandledCommand(s.service);
    const ctx = await command.execute({
        ...context(),
        failures: [{ service: 'OZON', offerId: '123-2', error: 'Акция отказала' }],
    });
    expect(ctx.pending).toEqual([{ np: '1', reasons: ['OZON 123-2: Акция отказала'] }]);
    expect(ctx.completed).toEqual([]);
    expect(s.tx.execute.mock.calls[0][0]).not.toContain('HANDLED_AT = CURRENT_TIMESTAMP');
    expect(JSON.parse(s.tx.execute.mock.calls[0][1][0]).incoming.pending).toEqual(ctx.pending[0].reasons);
});
it('смешанные приходы: подтверждённый завершается независимо от отказавшего', async () => {
    const s = journal();
    const ctx = context();
    ctx.prihods.push({ ...ctx.prihods[0], np: '2' });
    ctx.goodsByPrihod.set('2', ['456']);
    const result = await new MarkIncomingHandledCommand(s.service).execute({
        ...ctx,
        failures: [{ service: 'WB', offerId: '456', error: 'Цена не подтверждена' }],
    });
    expect(result.completed).toEqual(['1']);
    expect(result.pending.map((p) => p.np)).toEqual(['2']);
});
it('после ожидания новая версия не закрывается результатом предыдущей', async () => {
    const s = journal('новая версия');
    const ctx = await new MarkIncomingHandledCommand(s.service).execute(context());
    expect(ctx.completed).toEqual([]);
    expect(ctx.pending[0].reasons[0]).toContain('изменился');
    expect(s.tx.execute).not.toHaveBeenCalled();
});
it('проверка версии встроена в контекст пересчёта и останавливает старую отправку', async () => {
    const s = journal('новая версия');
    const execute = jest.fn(async (ctx) => {
        await ctx.assertInputsCurrent('123-2');
        return {};
    });
    const command = new RepriceIncomingGoodsCommand(
        { incomingGoodsChain: () => ({ execute }), chainLogger: () => undefined } as any,
        s.service,
    );
    await expect(command.execute(context())).rejects.toThrow('изменился');
});

it('чтение очереди сохраняет точную версию, PAYLOAD и прежние 15 минут тишины', async () => {
    const s = journal();
    s.tx.query.mockResolvedValueOnce([
        {
            EXT_ID: '1',
            STATE: 'pending',
            POSTING: null,
            FIRST_SEEN: new Date(),
            EVENT_VERSION: '2026-11-08 10:00:00.1234',
            PAYLOAD_TEXT: '{"incoming":{"pending":["ошибка"]}}',
        },
    ] as any);
    const rows = await s.service.listUnhandledRows('TRADE', 'INCOMING', 'pending', null, 15);
    expect(rows[0].version).toBe('2026-11-08 10:00:00.1234');
    expect(rows[0].payload).toEqual({ incoming: { pending: ['ошибка'] } });
    expect(s.tx.query.mock.calls[0][0]).toContain('DATEADD(-15 MINUTE TO CURRENT_TIMESTAMP)');
});
