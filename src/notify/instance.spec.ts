import { instanceTag, resolveInstance } from './instance';

const cfg = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as any;

describe('resolveInstance', () => {
    it('INSTANCE явно', () => {
        expect(resolveInstance(cfg({ INSTANCE: 'shop', FB_BASE: '/opt.fdb' }))).toBe('shop');
        expect(resolveInstance(cfg({ INSTANCE: ' OPT ' }))).toBe('opt');
    });
    it('без INSTANCE — по имени базы', () => {
        expect(resolveInstance(cfg({ FB_BASE: '/var/db/firebird/magazin.fdb' }))).toBe('shop');
        expect(resolveInstance(cfg({ FB_BASE: '/var/db/firebird/opt.fdb' }))).toBe('opt');
        expect(resolveInstance(cfg({ FB_BASE: '/var/db/firebird/opt.fdb#magazin.fdb' }))).toBe('opt');
        expect(resolveInstance(cfg({}))).toBe('opt');
    });
    it('тег единый с Trade', () => {
        expect(instanceTag('opt')).toBe('[опт]');
        expect(instanceTag('shop')).toBe('[розница]');
    });
});
