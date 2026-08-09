export class PostingsRequestDto {
    since: Date;
    to: Date;
    /** v3 (отключается 31.08.2026): скаляр. В v4 игнорируется — читается statuses. */
    status?: string;
    /** v4: массив, работает как OR. Невалидное значение даёт 400, в отличие от status. */
    statuses?: string[];
}
