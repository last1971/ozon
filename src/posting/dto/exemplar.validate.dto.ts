// Ответ /v5/fbs/posting/product/exemplar/validate — сухая проверка марок+ГТД перед set.
export interface ExemplarValidateMarkDto {
    mark?: string;
    mark_type?: string;
    valid?: boolean;
    errors?: string[];
}

export interface ExemplarValidateExemplarDto {
    exemplar_id?: number;
    valid?: boolean;
    errors?: string[];
    gtd?: string;
    marks?: ExemplarValidateMarkDto[];
}

export interface ExemplarValidateProductDto {
    product_id: number;
    valid?: boolean;
    error?: string;
    exemplars?: ExemplarValidateExemplarDto[];
}

export interface ExemplarValidateResponseDto {
    products?: ExemplarValidateProductDto[];
    // при грубой ошибке контракта Озон отдаёт code/message вместо products
    code?: number;
    message?: string;
}
