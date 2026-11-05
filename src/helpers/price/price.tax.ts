/** Действующая модель ОСНО проекта: одна функция для цены и проверки прибыли. */
export function priceTaxDetails(
    sum: number,
    base: number,
    fixed: number,
    dynamic: number,
    vatRate: number,
    profitTaxRate: number,
) {
    const divisor = 1 + vatRate / 100;
    const priceNoVAT = sum / divisor;
    const fixedNoVAT = fixed / divisor;
    const dynamicCost = (sum * dynamic) / 100;
    const dynamicNoVAT = dynamicCost / divisor;
    const costNoVAT = base / divisor;
    const profitBeforeTax = priceNoVAT - (fixedNoVAT + dynamicNoVAT + costNoVAT);
    const profitTax = (profitBeforeTax * profitTaxRate) / 100;
    const inputVAT = base - costNoVAT + (fixed - fixedNoVAT) + (dynamicCost - dynamicNoVAT);
    const vatToPay = Math.max(sum - priceNoVAT - inputVAT, 0);
    return { profitBeforeTax, profitTax, vatToPay };
}
