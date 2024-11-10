import { defineStore } from "pinia";
import { postingStore } from "@/stores/postings";
import { goodStore } from "@/stores/goods";
import type { ItemFbsDto } from "@/contracts/item.fbs.dto";
import axios from "@/axios.config";

export const labelStore = defineStore("labelStore", {
    state: () => ({
        isLoading: false,
    }),
    actions: {
        async fetchAndCombineData() {
            const postings = postingStore();
            const goods = goodStore();
            const { awaitingDelivery } = postings;
            // Запускаем загрузку заказов, если они еще не загружены
            if (!awaitingDelivery.length) {
                await postings.getAwaitingDelivery();
            }

            // Собираем SKU товаров из заказов
            const skus = postings.awaitingDelivery.flatMap(order =>
                order.products.map(product => product.offer_id)
            ) || [];

            // Определяем, какие SKU отсутствуют в goodStore
            const missingSkus = skus.filter(
                sku => !goods.goodInfos.some(good => good.sku === sku)
            );

            // Если есть недостающие товары, загружаем их
            if (missingSkus.length) {
                this.isLoading = true;
                await goods.getGoodInfoBySkus(missingSkus);
                this.isLoading = false;
            }
        },
        async getLabels(ids: string[]) {
            const data = this.ozonFbsLabels.filter(label => ids.includes(label.id));
            const orders = new Map<string, ItemFbsDto[]>();
            data.forEach(item => {
                if (!orders.has(item.order)) {
                    orders.set(item.order, [item]);
                } else {
                    orders.set(item.order, [...orders.get(item.order)!, item]);
                }
            });
            const labelsData = [];
            for (const order of orders) {
                labelsData.push({ code: order[0], description: `\nЗаказ OZON FBS ${order[0]}` });
                order[1].forEach((item) => {
                    labelsData.push(
                        ...Array(item.quantity).fill({ code: item.barcode, description: item.name }),
                    );
                })
            }
            const res = await axios.post(
                "/api/label/list",
                {
                    labelsData,
                    size: { width: 43, height: 25 },
                    barcodeType: 'code39',
                },
                { responseType: "arraybuffer" },
            );

            // Создаем Blob из полученных данных
            const blob = new Blob([res.data], { type: 'application/pdf' });

            // Создаем URL для Blob
            const url = URL.createObjectURL(blob);

            // Открываем PDF в новой вкладке
            window.open(url, '_blank');
        }
    },
    getters: {
        ozonFbsLabels(): ItemFbsDto[] {
            const postings = postingStore();
            const goods = goodStore();
            const { goodInfos } = goods;
            return postings.awaitingDelivery.flatMap(order =>
                order.products
                    .map(product => {
                        const goodInfo = goodInfos.find(
                            good => good.sku === product.offer_id
                        );

                        // Если товар найден, возвращаем объект товара, если нет — пропускаем
                        if (!goodInfo) return null;

                        return {
                            id: order.order_id,
                            image: goodInfo.primaryImage || '',
                            barcode: goodInfo.barCode,
                            sku: product.offer_id,
                            name: goodInfo.remark,
                            order: order.posting_number,
                            quantity: product.quantity,  // количество из заказа
                        };
                    })
                    .filter(product => product !== null)  // Убираем товары, которых нет
            );
        },
    },
});