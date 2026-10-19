import { Injectable } from '@nestjs/common';
import { WbApiService } from '../wb.api/wb.api.service';

/** Цена товара в кабинете ВБ сейчас: базовая (зачёркнутая), наша скидка и цена с нашей скидкой. */
export interface WbCurrentPrice {
    nmID: number;
    price: number;
    discount: number;
    /** Наша цена продажи: базовая минус наша скидка, без скидок ВБ покупателю. */
    discountedPrice: number;
}

/**
 * Единственное место, где читаются текущие цены кабинета ВБ («Цены и скидки», list/goods/filter).
 * Им пользуются пересчёт цен (базовая цена и скидка для задачи) и проверка прибыльности
 * (наша цена заказа, если статистика ВБ его не отдала).
 */
@Injectable()
export class WbCurrentPricesService {
    private static readonly URL = 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter';
    private static readonly LIMIT = 1000;

    constructor(private readonly api: WbApiService) {}

    /** Все товары кабинета постранично. Ключ — vendorCode (артикул продавца). */
    async getAll(): Promise<Map<string, WbCurrentPrice>> {
        const map = new Map<string, WbCurrentPrice>();
        for (let offset = 0; ; offset += WbCurrentPricesService.LIMIT) {
            const res = await this.api.method(
                WbCurrentPricesService.URL,
                'get',
                { limit: WbCurrentPricesService.LIMIT, offset },
                true,
            );
            const goods = res?.data?.listGoods ?? [];
            for (const g of goods) {
                const price = Number(g.sizes?.[0]?.price ?? 0);
                const discount = Number(g.discount ?? 0);
                const discounted = Number(g.sizes?.[0]?.discountedPrice);
                map.set(String(g.vendorCode), {
                    nmID: g.nmID,
                    price,
                    discount,
                    discountedPrice: discounted > 0 ? discounted : price * (1 - discount / 100),
                });
            }
            if (goods.length < WbCurrentPricesService.LIMIT) break;
        }
        return map;
    }
}
