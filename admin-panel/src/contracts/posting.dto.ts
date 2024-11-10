import type { ProductPostingDto } from "@/contracts/product.posting.dto";

export interface PostingDto {
    order_id: string;
    posting_number: string;
    status: string;
    in_process_at: string;
    products: ProductPostingDto[];
    analytics_data?: {
        warehouse_name: string;
    };
    isFbo?: boolean;
}