export type ExemplarShipStatus = 'ship_available' | 'ship_not_available' | 'validation_in_process';

export interface ExemplarStatusMarkDto {
    mark: string;
    mark_type: string;
    check_status: string;
    error_codes: string[];
}

export interface ExemplarStatusItemDto {
    exemplar_id: number;
    marks: ExemplarStatusMarkDto[];
}

export interface ExemplarStatusProductDto {
    product_id: number;
    exemplars: ExemplarStatusItemDto[];
}

export interface ExemplarStatusRequestDto {
    posting_number: string;
}

export interface ExemplarStatusResponseDto {
    posting_number: string;
    status: ExemplarShipStatus;
    products: ExemplarStatusProductDto[];
}
