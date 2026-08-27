import { AxiosError } from 'axios';

/** Ответ несёт диагностику (списки ошибок по позициям) — режем мягче, чем запрос. */
const MAX_RESPONSE_CHARS = 8000;
const MAX_REQUEST_CHARS = 2000;
/** Шумные и чувствительные заголовки в лог не идут. */
const SKIP_HEADERS = ['set-cookie', 'cookie', 'authorization', 'api-key'];

export interface AxiosErrorContext {
    url: string;
    method: string;
    body?: unknown;
}

const stringify = (value: unknown, limit: number): string => {
    if (value === undefined || value === null) return '';
    try {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return text.length > limit ? `${text.slice(0, limit)}…(обрезано)` : text;
    } catch {
        return String(value);
    }
};

/** Заголовки ответа нужны для разбора с поддержкой площадки: trace-id, retry-after и т.п. */
const formatHeaders = (headers: unknown): string => {
    if (!headers || typeof headers !== 'object') return '';
    const kept = Object.entries(headers as Record<string, unknown>).filter(
        ([name]) => !SKIP_HEADERS.includes(name.toLowerCase()),
    );
    return kept.length === 0 ? '' : stringify(Object.fromEntries(kept), MAX_REQUEST_CHARS);
};

/**
 * Единый формат лога для ошибок axios: статус, тело ответа, заголовки ответа, тело запроса.
 * Одна точка истины — раньше формат был продублирован в каждом api-сервисе.
 */
export function formatAxiosError(error: AxiosError | any, ctx: AxiosErrorContext): string {
    const status = error?.response?.status ?? '-';
    const statusText = error?.response?.statusText ?? '';
    const parts = [
        `${ctx.method.toUpperCase()} ${ctx.url}`,
        `status: ${status} ${statusText}`.trim(),
        `message: ${error?.message ?? 'unknown'}`,
    ];
    const responseData = stringify(error?.response?.data, MAX_RESPONSE_CHARS);
    if (responseData) parts.push(`response: ${responseData}`);
    const responseHeaders = formatHeaders(error?.response?.headers);
    if (responseHeaders) parts.push(`responseHeaders: ${responseHeaders}`);
    const body = stringify(ctx.body, MAX_REQUEST_CHARS);
    if (body) parts.push(`request: ${body}`);
    return parts.join(' | ');
}
