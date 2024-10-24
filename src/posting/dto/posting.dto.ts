import { ProductPostingDto } from '../../product/dto/product.posting.dto';

export class PostingDto {
    posting_number: string;
    status: string;
    in_process_at: string;
    products: ProductPostingDto[];
    analytics_data?: {
        warehouse_name: string;
    };
    isFbo?: boolean;
}
