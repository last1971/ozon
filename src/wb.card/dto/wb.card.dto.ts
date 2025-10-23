export class WbCardPhotoDto {
    big?: string;
    c246x328?: string;
    c516x688?: string;
    square?: string;
    tm?: string;
}

export class WbCardDimensionsDto {
    width?: number;
    height?: number;
    length?: number;
}

export class WbCardCharacteristicDto {
    id: number;
    name?: string;
    value: string | string[];
}

export class WbCardTagDto {
    id: number;
    name?: string;
    color?: string;
}

export class WbCardSizeDto {
    chrtID?: number;
    techSize?: string;
    wbSize?: string;
    skus: string[];
    price?: number;
    discountedPrice?: number;
}

export class WbCardDto {
    nmID: number;
    imtID?: number;
    nmUUID?: string;
    subjectID: number;
    subjectName: string;
    vendorCode: string;
    brand?: string;
    title: string;
    description?: string;
    needKiz?: boolean;
    kgvpMarketplace?: number;
    photos: WbCardPhotoDto[];
    video?: string;
    wholesale?: boolean;
    dimensions?: WbCardDimensionsDto;
    characteristics?: WbCardCharacteristicDto[];
    sizes: WbCardSizeDto[];
    tags?: WbCardTagDto[];
    createdAt?: string;
    updatedAt?: string;
}
