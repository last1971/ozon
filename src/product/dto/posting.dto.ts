import { ProductPostingDto } from './product.posting.dto';

export class PostingDto {
    posting_number: string;
    status: string;
    in_process_at: string;
    products: ProductPostingDto[];
}
