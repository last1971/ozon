export class ObtainCoeffsDto {
    minMil: number;
    percMil: number;
    percEkv: number;
    sumObtain: number;
    sumLabel: number;
    taxUnit: number;
    /** Подмена стоимости упаковки для площадки (вместо упаковки из наценок товара); не задана — как у товара. */
    sumPack?: number;
}
