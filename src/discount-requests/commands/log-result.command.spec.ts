import { LogResultCommand } from './log-result.command';

describe('LogResultCommand', () => {
  it('should log approved, declined and errors if logger exists', async () => {
    const logger = { log: jest.fn() };
    const command = new LogResultCommand();
    const context = { logger, approved: 2, declined: 1, errors: ['err1', 'err2'] };
    await command.execute(context);
    expect(logger.log).toHaveBeenCalledWith('Заявок апрувлено: 2');
    expect(logger.log).toHaveBeenCalledWith('Заявок отклонено: 1');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('err1'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('err2'));
  });
}); 