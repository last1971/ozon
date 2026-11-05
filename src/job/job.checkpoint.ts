import type { IJobContext } from '../interfaces/i.job.context';

/** Уступить event loop для HTTP-опроса прогресса; отмену проверяем до следующей порции работы. */
export async function jobCheckpoint(context?: Pick<IJobContext, 'stopChain'>): Promise<void> {
    if (context?.stopChain) throw new Error('Задача остановлена');
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (context?.stopChain) throw new Error('Задача остановлена');
}
