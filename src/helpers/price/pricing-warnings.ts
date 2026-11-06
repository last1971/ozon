import { AsyncLocalStorage } from 'async_hooks';
export interface PricingWarning {
    message: string;
    count: number;
    examples: string[];
}
const current = new AsyncLocalStorage<Map<string, PricingWarning>>();
export function pricingWarning(message: string, offer: string, fallback: (text: string) => void) {
    const warnings = current.getStore();
    if (!warnings) return fallback(`${offer}: ${message}`);
    const item = warnings.get(message) ?? { message, count: 0, examples: [] };
    item.count++;
    if (item.examples.length < 5 && !item.examples.includes(offer)) item.examples.push(offer);
    warnings.set(message, item);
}
export function withPricingWarnings<T>(warnings: Map<string, PricingWarning>, run: () => Promise<T>) {
    return current.run(warnings, run);
}
