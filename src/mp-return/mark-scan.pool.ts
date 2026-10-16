import { extractKi } from '../helpers';
import { ReturnLineCode } from '../interfaces/i.return.stock';
import { ReturnRefusedError } from './return-refused.error';

/**
 * Марки, отсканированные на одну кнопку экрана возвратов. Общие для всех возвратов кнопки:
 * каждый забирает коды своей строки счёта ровно на свои штуки (количественный код — своим QUANTITY),
 * то, что не подошло никому, — отказ всей кнопке. Один возврат — частный случай.
 */
export class MarkScanPool {
    private free: string[];
    private consulted = false;
    private marksRequired = false;
    /** Все коды строк, которые спрашивали: отличить «лишнюю свою марку» от чужой. */
    private readonly known = new Set<string>();

    constructor(scans: string[]) {
        this.free = [...new Set(scans.map((raw) => extractKi(raw)).filter(Boolean))];
    }

    /** Коды строки на `quan` штук в порядке скана; `codes = null` — строка без марок, забирать нечего. */
    take(codes: ReturnLineCode[] | null, quan: number): string[] {
        this.consulted = true;
        if (!codes) return [];
        this.marksRequired = true;
        codes.forEach((c) => this.known.add(c.ki));
        const byKi = new Map(codes.map((c) => [c.ki, c.quantity]));
        const taken: string[] = [];
        let pieces = 0;
        for (const ki of this.free) {
            const q = byKi.get(ki);
            if (q === undefined || pieces + q > quan) continue;
            taken.push(ki);
            pieces += q;
        }
        if (pieces !== quan) {
            const other = this.free.filter((ki) => !byKi.has(ki));
            const hint = other.length ? `; код не с этой строки счёта: ${other.join(', ')}` : '';
            throw new ReturnRefusedError(`Отсканировано марок на ${pieces} шт, вернулось ${quan}${hint}`);
        }
        this.free = this.free.filter((ki) => !taken.includes(ki));
        return taken;
    }

    /** После всех возвратов кнопки: лишних сканов быть не должно. Марки не спрашивали (проблема) — не проверяем. */
    assertAllUsed(): void {
        if (!this.consulted || !this.free.length) return;
        if (!this.marksRequired) throw new ReturnRefusedError('Марки не нужны: к строке счёта коды не привязаны');
        const foreign = this.free.filter((ki) => !this.known.has(ki));
        if (foreign.length) throw new ReturnRefusedError(`Код не с этой строки счёта: ${foreign.join(', ')}`);
        throw new ReturnRefusedError(`Лишние марки — вернувшимся штукам не нужны: ${this.free.join(', ')}`);
    }
}
