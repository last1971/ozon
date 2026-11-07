import { AccrualDto } from '../../posting/dto/accrual.dto';

export interface OzonSaleLine {
    posting: string;
    sku: string;
    units: number | null;
    kind: 'sale' | 'refund';
}

/** Одна проверка идентичности начисления для чтения и обработки перепроведений. */
export function uniqueAccruals(accruals: readonly AccrualDto[]): AccrualDto[] {
    const seen = new Map<string, string>();
    return accruals.filter((accrual) => {
        const id = String(accrual.accrual_id ?? '');
        if (!id) throw new Error('В истории Ozon отсутствует ID начисления');
        const signature = JSON.stringify(accrual);
        if (seen.has(id)) {
            if (seen.get(id) !== signature) throw new Error(`Разные данные начисления Ozon ${id}`);
            return false;
        }
        seen.set(id, signature);
        return true;
    });
}

export const ozonUnitsOf = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error('В истории Ozon отсутствует корректное количество единиц артикула');
    }
    return value;
};
export const ozonSkuOf = (value: unknown): string => {
    if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) {
        throw new Error('В истории Ozon отсутствует корректный SKU');
    }
    return String(value);
};

/** Знак продажи берём из sale_amount, а не из нетто после комиссии и доставки. */
export function readOzonSaleLines(accruals: AccrualDto[]): OzonSaleLine[] {
    const lines: OzonSaleLine[] = [];
    for (const accrual of uniqueAccruals(accruals)) {
        const id = String(accrual.accrual_id);
        if (accrual.accrued_category !== 'POSTING') continue;
        for (const product of accrual.posting?.products ?? []) {
            if (!product.commission) continue;
            const value = (product.commission as { sale_amount?: { amount?: string } }).sale_amount?.amount;
            const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
            if (!Number.isFinite(amount)) throw new Error(`Нет суммы продажи в начислении Ozon ${id}`);
            if (amount === 0) continue;
            const posting = accrual.unit_number?.trim();
            if (!posting) throw new Error(`Нет отправления в начислении Ozon ${id}`);
            let units: number | null;
            if (product.quantity != null) units = ozonUnitsOf(product.quantity);
            else {
                // Старые ответы не содержат quantity. sale_amount — сумма за все пачки,
                // seller_price — цена одной пачки; принимаем только целое положительное отношение.
                const unitValue = (product.commission as { seller_price?: { amount?: string } }).seller_price?.amount;
                const unitPrice = typeof unitValue === 'string' && unitValue.trim() !== '' ? Number(unitValue) : NaN;
                const ratio = amount / unitPrice;
                const rounded = Math.round(ratio);
                units =
                    Number.isSafeInteger(rounded) && rounded > 0 && Math.abs(ratio - rounded) <= 1e-8 ? rounded : null;
            }
            lines.push({ posting, sku: ozonSkuOf(product.sku), units, kind: amount > 0 ? 'sale' : 'refund' });
        }
    }
    return lines;
}

/** Точное сравнение денежных сумм без округления и потери точности Number. */
function canonicalValue(value: unknown, direction: number, field = ''): unknown {
    if (field === 'amount') {
        if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid money');
        const negative = value.startsWith('-');
        const [integer, fraction = ''] = value.replace(/^-/, '').split('.');
        const whole = integer.replace(/^0+(?=\d)/, '');
        const decimals = fraction.replace(/0+$/, '');
        const isZero = whole === '0' && !decimals;
        const normalizedNegative = !isZero && negative !== direction < 0;
        return (normalizedNegative ? '-' : '') + whole + (decimals ? '.' + decimals : '');
    }
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item, direction));
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonicalValue(value[key], direction, key)]),
        );
    }
    return value;
}

function financialIdentity(accrual: AccrualDto): { direction: number; signature: string } | null {
    if (
        accrual.accrued_category !== 'POSTING' ||
        !accrual.total_amount?.currency ||
        typeof accrual.total_amount?.amount !== 'string'
    )
        return null;
    const commissions = (accrual.posting?.products ?? []).filter((product) => product.commission);
    if (!commissions.length) return null;
    const amounts = commissions.map((product) =>
        Number((product.commission as { sale_amount?: { amount?: string } }).sale_amount?.amount),
    );
    if (amounts.some((amount) => !Number.isFinite(amount) || amount === 0)) return null;
    const direction = Math.sign(amounts[0]);
    if (amounts.some((amount) => Math.sign(amount) !== direction)) return null;
    try {
        const { accrual_id: _id, date: _date, ...financial } = accrual;
        return { direction, signature: JSON.stringify(canonicalValue(financial, direction)) };
    } catch {
        return null;
    }
}

/**
 * Убирает только подтверждённое полное перепроведение: +A, -A, +A по одному отправлению.
 * Совпадают все финансовые поля (включая доставку, комиссии, валюту, SKU и количество).
 * Любая запись возврата по отправлению запрещает автоматическое сворачивание.
 * Неполные цепочки и несовпадения остаются для проверки, исходная история не меняется.
 */
export function normalizeOzonRebookings(
    accruals: readonly AccrualDto[],
    postingsWithReturns: ReadonlySet<string>,
): { accruals: AccrualDto[]; ambiguousPostings: ReadonlySet<string> } {
    const unique = uniqueAccruals(accruals);
    const groups = new Map<string, AccrualDto[]>();
    for (const accrual of unique) {
        if (!accrual.unit_number) continue;
        const group = groups.get(accrual.unit_number) ?? [];
        group.push(accrual);
        groups.set(accrual.unit_number, group);
    }
    const excluded = new Set<string>();
    const ambiguousPostings = new Set<string>();
    for (const group of groups.values()) {
        // Дата операции и числовой ID определяют порядок независимо от порядка SQL/массива.
        group.sort(
            (a, b) =>
                a.date.localeCompare(b.date) ||
                String(a.accrual_id).localeCompare(String(b.accrual_id), 'en', { numeric: true }),
        );
        const stack: { accrual: AccrualDto; identity: ReturnType<typeof financialIdentity> }[] = [];
        for (const accrual of group) {
            const identity = financialIdentity(accrual);
            const previous = stack[stack.length - 2];
            const reversal = stack[stack.length - 1];
            if (
                identity?.direction === 1 &&
                previous?.identity?.direction === 1 &&
                reversal?.identity?.direction === -1 &&
                identity.signature === previous.identity.signature &&
                identity.signature === reversal.identity.signature
            ) {
                if (postingsWithReturns.has(accrual.unit_number)) {
                    ambiguousPostings.add(accrual.unit_number);
                } else {
                    excluded.add(String(previous.accrual.accrual_id));
                    excluded.add(String(reversal.accrual.accrual_id));
                    stack.splice(-2);
                }
            }
            stack.push({ accrual, identity });
        }
    }
    return { accruals: unique.filter((accrual) => !excluded.has(String(accrual.accrual_id))), ambiguousPostings };
}
