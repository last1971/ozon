import { PostingDto } from './posting.dto';

export class PostingsDto {
    postings: PostingDto[];
    /** v4/v3: ответ плоский, обёртки result больше нет; курсор вместо offset. */
    has_next?: boolean;
    cursor?: string;
}
