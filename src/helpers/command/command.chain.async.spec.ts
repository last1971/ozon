import { CommandChainAsync } from './command.chain.async';
import { ICommandAsync } from 'src/interfaces/i.command.acync';

describe('CommandChainAsync', () => {
  it('should execute all commands in order and pass context', async () => {
    const calls: string[] = [];
    const command1: ICommandAsync<any> = {
      execute: async (ctx) => {
        calls.push('cmd1');
        ctx.value = (ctx.value || 0) + 1;
        return ctx;
      }
    };
    const command2: ICommandAsync<any> = {
      execute: async (ctx) => {
        calls.push('cmd2');
        ctx.value = (ctx.value || 0) + 2;
        return ctx;
      }
    };
    const chain = new CommandChainAsync([command1, command2]);
    const context = { value: 0 };
    const result = await chain.execute(context);
    expect(calls).toEqual(['cmd1', 'cmd2']);
    expect(result.value).toBe(3);
  });
}); 