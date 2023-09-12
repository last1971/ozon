export class PostingsFboRequestDto {
    limit: number;
    filter: {
        since: Date;
        status: string;
        to: Date;
    };
    with: {
        analytics_data: boolean;
    };
}
