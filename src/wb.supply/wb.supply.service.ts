import { HttpException, Injectable } from "@nestjs/common";
import { WbApiService } from '../wb.api/wb.api.service';
import { WbSupplyDto } from './dto/wb.supply.dto';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from '../supply/dto/supply.dto';
import { GoodServiceEnum } from '../good/good.service.enum';
import { SupplyPositionDto } from 'src/supply/dto/supply.position.dto';
import { WbSupplyOrdersDto } from "./dto/wb.supply.orders.dto";
import { WbOrderService } from "../wb.order/wb.order.service";
import { find } from "lodash";

@Injectable()
export class WbSupplyService implements ISuppliable {
    private next: number = 0;
    private supplies: WbSupplyDto[] = [];

    constructor(private api: WbApiService, private wbOrderService: WbOrderService) {
    }

    async getSupplyPositions(id: string): Promise<SupplyPositionDto[]> {
        const data = await this.listOrders(id);
        if (!data.success) {
            throw new HttpException(data.error, 400);
        }
        const maxOrdersPerRequest = 100;
        let remainingOrders = data.orders.slice();

        if (remainingOrders.length === 0) {
            return [];
        }

        const allPositions: SupplyPositionDto[] = [];

        do {
            const batch = remainingOrders.slice(0, maxOrdersPerRequest);
            remainingOrders = remainingOrders.slice(maxOrdersPerRequest);

            const labelsResponse = await this.wbOrderService.getOrdersStickers(
                batch.map(order => order.id)
            );

            if (!labelsResponse.success) {
                throw new HttpException(labelsResponse.error, 400);
            }

            allPositions.push(
                ...batch.map((order) => ({
                    supplyId: id,
                    barCode: find(labelsResponse.stickers, sticker => sticker.orderId === order.id)?.barcode || "",
                    remark: order.article,
                    quantity: 1,
                }))
            );
        } while (remainingOrders.length > 0);

        return allPositions;
        
    }

    async list(next = 0): Promise<WbSupplyDto[]> {
        const res = await this.api.method(
            'https://marketplace-api.wildberries.ru/api/v3/supplies',
            'get',
            { limit: 1000, next },
            true,
        );
        this.next = res?.next ?? 0;
        return res?.supplies ?? [];
    }

    async updateSupplies(): Promise<void> {
        let supplies: WbSupplyDto[];
        this.supplies = [];
        do {
            supplies = await this.list(this.next);
            this.supplies = this.supplies.concat(supplies);
        } while (supplies.length);
    }

    async getSupplies(): Promise<SupplyDto[]> {
        await this.updateSupplies();
        return this.supplies
            .filter((supply) => !supply.done)
            .map((supply) => ({
                id: supply.id,
                remark: supply.name,
                isMarketplace: true,
                goodService: GoodServiceEnum.WB,
            }));
    }

    async listOrders(id: string): Promise<WbSupplyOrdersDto> {
        try {
            const data = await this.api.method(
                `https://marketplace-api.wildberries.ru/api/v3/supplies/${id}/orders`,
                'get',
                {},
                true,
            );

            return {
                orders: data.orders,
                success: true,
                error: null,
            };
        } catch (error) {
            return {
                orders: [],
                success: false,
                error: (error as Error).message || 'Неизвестная ошибка',
            };
        }
    }
}
