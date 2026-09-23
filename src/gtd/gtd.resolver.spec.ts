import { GtdResolver } from './gtd.resolver';
import { OzonGtdFormat } from './ozon.gtd.format';
import { IGtdContext } from './gtd.context';
import { PartyReceiptGtdCommand } from './commands/party-receipt.gtd.command';
import { LastGoodReceiptGtdCommand } from './commands/last-good-receipt.gtd.command';

/** Источник-заглушка: кладёт заданных кандидатов и считает, сколько раз его спросили. */
const source = (candidates: string[]) => {
    const execute = jest.fn(async (ctx: IGtdContext) => {
        ctx.candidates = candidates;
        return ctx;
    });
    return { execute } as unknown as PartyReceiptGtdCommand & { execute: jest.Mock };
};

describe('GtdResolver', () => {
    const party = { partyId: 1, goodscode: '565565', partyDate: new Date('2026-08-03') };
    const transaction = {} as any;

    const build = (partyReceipt: any, lastGoodReceipt: any) =>
        new GtdResolver(new OzonGtdFormat(), partyReceipt, lastGoodReceipt as LastGoodReceiptGtdCommand);

    it('есть приход у партии — второй источник не трогаем', async () => {
        const first = source(['10131010/250526/5164730/1']);
        const second = source(['10013160/030324/3074100']);
        const resolver = build(first, second);

        expect(await resolver.resolve(party, transaction)).toBe('10131010/250526/5164730');
        expect(second.execute).not.toHaveBeenCalled();
    });

    it('у партии прихода нет — берём ГТД соседнего прихода товара', async () => {
        const resolver = build(source([]), source(['10131010/250526/5164730/1']));
        expect(await resolver.resolve(party, transaction)).toBe('10131010/250526/5164730');
    });

    /**
     * Та самая дыра, из-за которой фолбэк был бы мёртвым: COALESCE вернул бы негодный номер
     * СВОЕЙ партии, поиск остановился бы на нём, и до соседних приходов дело не дошло.
     */
    it('номер своей партии не в формате Озона — идём дальше, а не отдаём null', async () => {
        const resolver = build(source(['10210090/160910/п014454/13']), source(['10131010/250526/5164730']));
        expect(await resolver.resolve(party, transaction)).toBe('10131010/250526/5164730');
    });

    it('внутри источника кривые кандидаты пропускаются, берётся первый годный', async () => {
        const resolver = build(
            source([]),
            source(['10132160/26115/5241506', '------', '10013160/030324/3074100/1']),
        );
        expect(await resolver.resolve(party, transaction)).toBe('10013160/030324/3074100');
    });

    it('годных кандидатов нет нигде → null', async () => {
        const resolver = build(source(['------']), source(['10210090/160910/п014454']));
        expect(await resolver.resolve(party, transaction)).toBeNull();
    });

    it('кандидаты источника не протекают в следующий источник', async () => {
        const second = source([]);
        const resolver = build(source(['------']), second);
        expect(await resolver.resolve(party, transaction)).toBeNull();
        expect(second.execute.mock.calls[0][0].candidates).toEqual([]);
    });
});
