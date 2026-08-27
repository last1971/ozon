/** Статусы объявления в ответе GET /core/v1/accounts/{accountId}/items/{itemId}/ */
export enum AvitoItemStatus {
    Active = 'active',
    Old = 'old',
    Removed = 'removed',
    Rejected = 'rejected',
    Blocked = 'blocked',
}

/**
 * Результат опроса статуса. «Не знаем статус» и «не смогли спросить» разделены намеренно:
 * новый статус в API Авито не должен выглядеть как сетевой сбой и молчать в логах.
 */
export type AvitoItemProbe =
    | { kind: 'status'; status: AvitoItemStatus }
    | { kind: 'unknown-status'; raw: string }
    | { kind: 'unreachable'; message: string };

/**
 * Единственное правило «объявление мертво навсегда».
 * old (архив) и rejected (отклонено модерацией) возвращаются под тем же item_id — их не трогаем.
 */
export const isPermanentlyGone = (probe: AvitoItemProbe): boolean =>
    probe.kind === 'status' && probe.status === AvitoItemStatus.Removed;

export const toAvitoItemProbe = (raw: unknown): AvitoItemProbe => {
    const known = Object.values(AvitoItemStatus).find((status) => status === raw);
    return known ? { kind: 'status', status: known } : { kind: 'unknown-status', raw: String(raw) };
};
