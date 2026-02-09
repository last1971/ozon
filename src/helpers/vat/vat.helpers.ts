/**
 * Преобразует число (проценты) в формат НДС для Озона (строка как доля)
 * 5 -> '0.05', 7 -> '0.07', 10 -> '0.1', 20 -> '0.2', 22 -> '0.22', остальное -> '0'
 */
export function numberToVat(vat: number): string {
    switch (vat) {
        case 5:
            return '0.05';
        case 7:
            return '0.07';
        case 10:
            return '0.1';
        case 20:
            return '0.2';
        case 22:
            return '0.22';
        default:
            return '0';
    }
}
