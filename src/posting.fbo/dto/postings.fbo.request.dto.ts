export class PostingsFboRequestDto {
    limit: number;
    /** v3: курсорная пагинация вместо offset. */
    cursor?: string;
    filter: {
        since: Date;
        to: Date;
        /** v2 (отключается 31.08.2026): скаляр. */
        status?: string;
        /** v3: массив. */
        statuses?: string[];
    };
    with: {
        analytics_data: boolean;
        financial_data?: boolean;
    };
}
