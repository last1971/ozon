import { SyliusShowcaseController } from './sylius.showcase.controller';

describe('SyliusShowcaseController', () => {
    it.each([
        ['1', true],
        ['true', true],
        ['0', false],
        [undefined, false],
    ])('dryRun=%s → run(%s), без list — все списки', async (q, expected) => {
        const run = jest.fn().mockResolvedValue({});
        await new SyliusShowcaseController({ run } as any).sylius(q as any);
        expect(run).toHaveBeenCalledWith(expected, ['new', 'hits', 'arrivals', 'deals']);
    });

    it('list=deals — только переотправка deals', async () => {
        const run = jest.fn().mockResolvedValue({});
        await new SyliusShowcaseController({ run } as any).sylius(undefined, 'deals');
        expect(run).toHaveBeenCalledWith(false, ['deals']);
    });
});
