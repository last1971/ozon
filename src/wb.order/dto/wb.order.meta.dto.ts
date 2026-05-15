export interface WbOrderMetaFieldsDto {
    sgtin?: string[];
    gtin?: string[];
    imei?: string[];
    uin?: string[];
}

export interface WbOrderMetaDto {
    meta: WbOrderMetaFieldsDto;
    requiredMeta?: string[];
    optionalMeta?: string[];
}
