import { defineStore } from "pinia";
import { postingStore } from "@/stores/postings";
import { GoodServiceEnum, goodStore } from "@/stores/goods";
import type { ItemFbsDto } from "@/contracts/item.fbs.dto";
import axios from "@/axios.config";
import type { SizeDto } from "@/contracts/size.dto";

export const labelStore = defineStore("labelStore", {
    state: () => ({
        isLoading: false,
        service: GoodServiceEnum.OZON,
    }),
    actions: {
        async fetchAndCombineData(service: GoodServiceEnum) {
            this.service = service;
            const postings = postingStore();
            const goods = goodStore();
            const { awaitingDelivery } = postings;
            // Запускаем загрузку заказов, если они еще не загружены
            if (!awaitingDelivery.length) {
                await postings.getAwaitingDelivery(service);
            }

            // Собираем SKU товаров из заказов
            const skus = postings.awaitingDelivery.flatMap(order =>
                order.products.map(product => product.offer_id)
            ) || [];

            // Определяем, какие SKU отсутствуют в goodStore
            const goodInfos = goods.goodInfos.get(service) || [];
            const missingSkus = skus.filter(
                sku => !goodInfos.some(good => good.sku === sku)
            );

            // Если есть недостающие товары, загружаем их
            if (missingSkus.length) {
                this.isLoading = true;
                await goods.getGoodInfoBySkus(missingSkus, service);
                this.isLoading = false;
            }
        },
        async getLabels(ids: string[], barcodeType: string, size: SizeDto) {
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
                labelsData.push({ code: order[0], description: `\nЗаказ ${this.service.toString().toUpperCase()} FBS ${order[0]}` });
                order[1].forEach((item) => {
                    labelsData.push(
                        ...Array(item.quantity)
                            .fill({ code: item.barcode, description: `Арт: ${item.sku} / ${item.name}` }),
                    );
                })
            }
            const res = await axios.post(
                "/api/label/list",
                {
                    labelsData,
                    size,
                    barcodeType,
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
            const goodInfos = goods.goodInfos.get(this.service) || [];
            return postings.awaitingDelivery.flatMap(order =>
                order.products
                    .map(product => {
                        const goodInfo = goodInfos.find(
                            good => good.sku === product.offer_id
                        );

                        // Если товар найден, возвращаем объект товара, если нет — пропускаем
                        if (!goodInfo) return null;
                        return {
                            id: order.posting_number,
                            image: goodInfo.primaryImage || '',
                            barcode: goodInfo.barCode,
                            sku: product.offer_id,
                            name: goodInfo.remark,
                            order: order.posting_number,
                            quantity: product.quantity,  // количество из заказа
                        };
                    })
                    .filter((product): product is ItemFbsDto => product !== null)  // Убираем товары, которых нет
            );
        },
    },
});