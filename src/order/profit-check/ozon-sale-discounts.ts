import type { PostingDto } from '../../posting/dto/posting.dto';

/** Скидку связываем со SKU строки, а не с заказом целиком или кодом без фасовки. */
export function ozonWannaDiscountSkus(posting: PostingDto): Set<string> {
    const result = new Set<string>();
    const products = posting.financial_data?.products;
    if (!Array.isArray(products)) return result;
    for (const product of products) {
        if (product?.product_id == null || !Array.isArray(product.actions)) continue;
        if (
            product.actions.some((action) => typeof action === 'string' && /^WANNADISCOUNT(?:-|$)/i.test(action.trim()))
        )
            result.add(String(product.product_id));
    }
    return result;
}
