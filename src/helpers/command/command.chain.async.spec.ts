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
            },
        };
        const command2: ICommandAsync<any> = {
            execute: async (ctx) => {
                calls.push('cmd2');
                ctx.value = (ctx.value || 0) + 2;
                return ctx;
            },
        };
        const chain = new CommandChainAsync([command1, command2]);
        const context = { value: 0 };
        const result = await chain.execute(context);
        expect(calls).toEqual(['cmd1', 'cmd2']);
        expect(result.value).toBe(3);
    });

    it('should stop execution if stopChain is set', async () => {
        const calls: string[] = [];
        const command1: ICommandAsync<any> = {
            execute: async (ctx) => {
                calls.push('cmd1');
                ctx.value = 1;
                ctx.stopChain = true;
                return ctx;
            },
        };
        const command2: ICommandAsync<any> = {
            execute: async (ctx) => {
                calls.push('cmd2');
                ctx.value = 2;
                return ctx;
            },
        };
        const chain = new CommandChainAsync([command1, command2]);
        const context = { value: 0 };
        const result = await chain.execute(context);
        expect(calls).toEqual(['cmd1']);
        expect(result.value).toBe(1);
        expect(result.stopChain).toBe(true);
    });

    it('should work with logger in context', async () => {
        const logs: string[] = [];
        const logger = { log: (msg: string) => logs.push(msg) };
        const command: ICommandAsync<any> = {
            execute: async (ctx) => {
                if (ctx.logger) ctx.logger.log('test log');
                return ctx;
            },
        };
        const chain = new CommandChainAsync([command]);
        const context = { logger };
        await chain.execute(context);
        expect(logs).toContain('test log');
    });
});
