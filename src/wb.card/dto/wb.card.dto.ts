export class WbCardSizeDto {
    skus: string[];
}
export class WbCardDto {
    nmID: number;
    subjectID: number;
    subjectName: string;
    vendorCode: string;
    sizes: WbCardSizeDto[];
}
