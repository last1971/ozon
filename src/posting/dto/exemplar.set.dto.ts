export interface ExemplarSetMarkDto {
    mark: string;
    mark_type: 'mandatory_mark';
}

export interface ExemplarSetItemDto {
    exemplar_id: number;
    marks: ExemplarSetMarkDto[];
    gtd: string;
    is_gtd_absent: boolean;
    is_rnpt_absent: true;
}

export interface ExemplarSetProductDto {
    product_id: number;
    exemplars: ExemplarSetItemDto[];
}

export interface ExemplarSetRequestDto {
    posting_number: string;
    multi_box_qty: number;
    products: ExemplarSetProductDto[];
}

export interface ExemplarSetResponseDto {
    result: boolean;
}
