import { MpReturnChainFactory } from './mp-return.chain.factory';
import { RunWriteOffCommand } from './commands/run-write-off.command';

/** Каждой команде — отдельный объект с именем, чтобы видеть состав цепочки. */
const cmd = (name: string) => ({ name, execute: jest.fn(async (c) => c) });
const names = [
    'load',
    'notProcessed',
    'acceptable',
    'problemComment',
    'validateMarks',
    'unretire',
    'release',
    'disband',
    'restate',
    'record',
    'writeOffAllowed',
    'allocateSpisCode',
    'stampMarks',
    'createDoc',
    'recordWriteOff',
];
const factory = () => new (MpReturnChainFactory as any)(...names.map(cmd)) as MpReturnChainFactory;
const composition = (chain: any) =>
    chain.commands.map((c: any) => (c instanceof RunWriteOffCommand ? 'runWriteOff' : c.name));

describe('MpReturnChainFactory', () => {
    it('«Вернуть» — приём по шагам плана, в этом порядке', () => {
        expect(composition(factory().forAction('return'))).toEqual([
            'load',
            'notProcessed',
            'acceptable',
            'validateMarks',
            'unretire',
            'release',
            'disband',
            'restate',
            'record',
        ]);
    });

    it('«Вернуть и списать» — тот же приём + переходник в цепочку списания', () => {
        const chain = composition(factory().forAction('return-writeoff'));
        expect(chain.slice(0, -1)).toEqual(composition(factory().forAction('return')));
        expect(chain[chain.length - 1]).toBe('runWriteOff');
    });

    it('«Проблема» — без складских шагов', () => {
        expect(composition(factory().forAction('problem'))).toEqual([
            'load',
            'notProcessed',
            'problemComment',
            'record',
        ]);
    });

    it('«Списать» — цепочка списания', () => {
        expect(composition(factory().writeOff())).toEqual([
            'writeOffAllowed',
            'allocateSpisCode',
            'stampMarks',
            'createDoc',
            'recordWriteOff',
        ]);
    });
});
