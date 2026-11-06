import {
    ProductCodeStockDto,
    ProductCodeUpdateStockDto,
    ProductCodeUpdateStockResultDto,
} from './dto/product.code.dto';

type Entry = { stock: ProductCodeStockDto; attempts: number; resolve: (row: ProductCodeUpdateStockDto) => void };
/** Одна очередь пары товар–склад. Последнее значение заменяет ещё не отправленное.
 * Лимиты Ozon: 100 пар в запросе, одна пара раз в 30 секунд, до 80 запросов/мин.
 * https://dev.ozon.ru/start/299-Rekomendatsii-po-upravleniiu-ostatkami-v-Seller-API/
 */
export class OzonStockWriter {
    private readonly pending = new Map<string, Entry>();
    private readonly nextAt = new Map<string, number>();
    private running = false;
    private timer?: ReturnType<typeof setTimeout>;
    private nextRequest = 0;
    constructor(
        private readonly send: (stocks: ProductCodeStockDto[]) => Promise<ProductCodeUpdateStockResultDto>,
        private readonly intervalMs = 30000,
        private readonly requestMs = 800,
        private readonly maxRetries = 2,
    ) {}

    async update(stocks: ProductCodeStockDto[]): Promise<ProductCodeUpdateStockResultDto> {
        const rows = stocks.map(
            (stock) =>
                new Promise<ProductCodeUpdateStockDto>((resolve) => {
                    const key = this.key(stock);
                    const previous = this.pending.get(key);
                    if (previous) previous.resolve(this.superseded(previous));
                    this.pending.set(key, { stock: { ...stock }, attempts: 0, resolve });
                }),
        );
        this.schedule();
        return { result: await Promise.all(rows) };
    }
    private key(stock: ProductCodeStockDto) {
        return `${stock.warehouse_id}:${stock.offer_id}`;
    }
    private superseded(entry: Entry): ProductCodeUpdateStockDto {
        return { offer_id: entry.stock.offer_id, updated: false, errors: [], superseded: true };
    }
    private schedule() {
        if (this.running) return;
        if (this.timer) clearTimeout(this.timer);
        if (!this.pending.size) return;
        const earliest = Math.min(...[...this.pending.keys()].map((key) => this.nextAt.get(key) ?? 0));
        const delay = Math.max(0, earliest - Date.now(), this.nextRequest - Date.now());
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
        }, delay);
    }
    private async flush() {
        this.running = true;
        const now = Date.now();
        const entries = [...this.pending.entries()].filter(([key]) => (this.nextAt.get(key) ?? 0) <= now).slice(0, 100);
        for (const [key] of entries) {
            this.pending.delete(key);
            this.nextAt.set(key, now + this.intervalMs);
        }
        this.nextRequest = now + this.requestMs;
        try {
            const response = await this.send(entries.map(([, entry]) => entry.stock));
            for (const [key, entry] of entries) {
                const rows = response?.result?.filter((r) => r.offer_id === entry.stock.offer_id) ?? [];
                const row =
                    rows.find((r) => r.warehouse_id !== undefined && r.warehouse_id === entry.stock.warehouse_id) ??
                    (rows.length === 1 &&
                    rows[0].warehouse_id === undefined &&
                    entries.filter(([, other]) => other.stock.offer_id === entry.stock.offer_id).length === 1
                        ? rows[0]
                        : undefined);
                const error = (response as any)?.error;
                const result: ProductCodeUpdateStockDto = row ?? {
                    offer_id: entry.stock.offer_id,
                    updated: false,
                    errors: [
                        {
                            code: error?.status === 429 ? 'TOO_MANY_REQUESTS' : 'API_ERROR',
                            message: String(error?.message || 'Ozon не подтвердил остаток'),
                        },
                    ],
                };
                const limited =
                    !result.updated &&
                    result.errors?.some((e) =>
                        typeof e === 'string'
                            ? /TOO_MANY_REQUESTS|Stock is updated too frequently/i.test(e)
                            : e.code === 'TOO_MANY_REQUESTS',
                    );
                if (limited && entry.attempts++ < this.maxRetries) {
                    this.nextAt.set(key, Date.now() + this.intervalMs);
                    if (this.pending.has(key)) entry.resolve(this.superseded(entry));
                    else this.pending.set(key, entry);
                } else {
                    entry.resolve(result);
                    const newer = this.pending.get(key);
                    if (result.updated && newer?.stock.stock === entry.stock.stock) {
                        this.pending.delete(key);
                        newer.resolve(result);
                    }
                }
            }
        } catch (error) {
            for (const [, entry] of entries)
                entry.resolve({
                    offer_id: entry.stock.offer_id,
                    updated: false,
                    errors: [
                        { code: 'REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) },
                    ],
                });
        } finally {
            this.running = false;
            for (const [key, due] of this.nextAt)
                if (due <= Date.now() && !this.pending.has(key)) this.nextAt.delete(key);
            this.schedule();
        }
    }
}
