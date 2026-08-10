export class PostingsRequestDto {
    since: Date;
    to: Date;
    /** v3 (отключается 31.08.2026): скаляр. В v4 игнорируется — читается statuses. */
    status?: string;
    /** v4: массив, работает как OR. Невалидное значение даёт 400, в отличие от status. */
    statuses?: string[];
    /**
     * Окно по дате смены статуса, ISO. В `/v4/posting/fbs/list` работает (обмер: 1 ч → 5,
     * 24 ч → 49, заведомо пустое → 0), в `/v3/posting/fbo/list` поле мёртвое — туда не передаём.
     */
    last_changed_status_date?: { from: string; to: string };
}
