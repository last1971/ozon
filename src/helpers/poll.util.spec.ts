import { pollUntil, PollDecision } from './poll.util';

describe('pollUntil', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('сразу done — без задержек, probe вызван 1 раз', async () => {
        const probe = jest.fn().mockResolvedValue('ok');
        const result = await pollUntil(probe, () => 'done');
        expect(result).toEqual({ status: 'done', value: 'ok' });
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('сразу fail — без задержек, probe вызван 1 раз', async () => {
        const probe = jest.fn().mockResolvedValue('bad');
        const result = await pollUntil(probe, () => 'fail');
        expect(result).toEqual({ status: 'fail', value: 'bad' });
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('continue → done после нескольких попыток', async () => {
        const probe = jest
            .fn()
            .mockResolvedValueOnce('pending')
            .mockResolvedValueOnce('pending')
            .mockResolvedValueOnce('ready');
        const decide = (v: string): PollDecision => (v === 'ready' ? 'done' : 'continue');
        const promise = pollUntil(probe, decide, [10, 20]);
        await jest.advanceTimersByTimeAsync(50);
        const result = await promise;
        expect(result).toEqual({ status: 'done', value: 'ready' });
        expect(probe).toHaveBeenCalledTimes(3);
    });

    it('continue → fail прерывает цикл', async () => {
        const probe = jest
            .fn()
            .mockResolvedValueOnce('pending')
            .mockResolvedValueOnce('error');
        const decide = (v: string): PollDecision => {
            if (v === 'error') return 'fail';
            return 'continue';
        };
        const promise = pollUntil(probe, decide, [10, 20]);
        await jest.advanceTimersByTimeAsync(50);
        const result = await promise;
        expect(result).toEqual({ status: 'fail', value: 'error' });
        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('timeout — N задержек → N+1 попытка → timeout', async () => {
        const probe = jest.fn().mockResolvedValue('pending');
        const promise = pollUntil(probe, () => 'continue', [10, 20]);
        await jest.advanceTimersByTimeAsync(100);
        const result = await promise;
        expect(result).toEqual({ status: 'timeout', value: 'pending' });
        expect(probe).toHaveBeenCalledTimes(3);
    });

    it('пустой массив задержек — одна попытка, дальше timeout', async () => {
        const probe = jest.fn().mockResolvedValue('pending');
        const result = await pollUntil(probe, () => 'continue', []);
        expect(result).toEqual({ status: 'timeout', value: 'pending' });
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('пробрасывает ошибку из probe', async () => {
        const probe = jest.fn().mockRejectedValue(new Error('net'));
        await expect(pollUntil(probe, () => 'done')).rejects.toThrow('net');
    });

    it('дефолтные задержки используются если не переданы', async () => {
        const probe = jest
            .fn()
            .mockResolvedValueOnce('pending')
            .mockResolvedValueOnce('ready');
        const decide = (v: string): PollDecision => (v === 'ready' ? 'done' : 'continue');
        const promise = pollUntil(probe, decide);
        await jest.advanceTimersByTimeAsync(2000);
        const result = await promise;
        expect(result).toEqual({ status: 'done', value: 'ready' });
        expect(probe).toHaveBeenCalledTimes(2);
    });
});
