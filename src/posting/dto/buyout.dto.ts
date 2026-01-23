export class BuyoutDto {
    posting_number: string;
    amount: number;
    offer_id: string;
    sku: number;
    seller_price_per_instance: number;
    buyout_price: number;
    quantity: number;
    name?: string;
    deduction_by_category_percent?: number;
    vat_percent?: number;
}
