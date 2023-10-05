export class WbCardSizeDto {
    skus: string[];
}
export class WbCardDto {
    nmID: number;
    vendorCode: string;
    sizes: WbCardSizeDto[];
}
