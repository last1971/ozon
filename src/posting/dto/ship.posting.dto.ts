export interface ShipPostingProductDto {
    product_id: number;
    quantity: number;
    exemplar_ids: number[];
}

export interface ShipPostingPackageDto {
    products: ShipPostingProductDto[];
}

export interface ShipPostingRequestDto {
    posting_number: string;
    packages: ShipPostingPackageDto[];
}

export interface ShipPostingResponseDto {
    result?: string[];
    additional_data?: unknown[];
}
