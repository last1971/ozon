export interface ExemplarMarkDto {
    mark: string;
    mark_type: string;
}

export interface ExemplarItemDto {
    exemplar_id: number;
    marks: ExemplarMarkDto[];
    gtd?: string;
    is_gtd_absent?: boolean;
    rnpt?: string;
    is_rnpt_absent?: boolean;
}

export interface ExemplarProductDto {
    product_id: number;
    quantity: number;
    is_mandatory_mark_needed: boolean;
    exemplars: ExemplarItemDto[];
}

export interface ExemplarCreateOrGetRequestDto {
    posting_number: string;
}

export interface ExemplarCreateOrGetResponseDto {
    posting_number: string;
    multi_box_qty: number;
    products: ExemplarProductDto[];
}
