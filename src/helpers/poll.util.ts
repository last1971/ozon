export type PollDecision = 'done' | 'fail' | 'continue';

export interface PollResult<T> {
    status: 'done' | 'fail' | 'timeout';
    value: T | null;
}

const DEFAULT_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];

export async function pollUntil<T>(
    probe: () => Promise<T>,
    decide: (v: T) => PollDecision,
    delaysMs: number[] = DEFAULT_DELAYS_MS,
): Promise<PollResult<T>> {
    let lastValue: T | null = null;
    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
        const value = await probe();
        lastValue = value;
        const decision = decide(value);
        if (decision === 'done') return { status: 'done', value };
        if (decision === 'fail') return { status: 'fail', value };
        if (attempt < delaysMs.length) {
            await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
        }
    }
    return { status: 'timeout', value: lastValue };
}
