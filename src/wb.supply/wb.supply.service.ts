import { HttpException, Injectable } from "@nestjs/common";
import { WbApiService } from '../wb.api/wb.api.service';
import { WbSupplyDto } from './dto/wb.supply.dto';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from '../supply/dto/supply.dto';
import { GoodServiceEnum } from '../good/good.service.enum';
import { SupplyPositionDto } from 'src/supply/dto/supply.position.dto';
import { WbOrderService } from "../wb.order/wb.order.service";
import { find } from "lodash";

@Injectable()
export class WbSupplyService implements ISuppliable {
    private next: number = 0;
    private supplies: WbSupplyDto[] = [];

    constructor(private api: WbApiService, private wbOrderService: WbOrderService) {
    }

    async getSupplyPositions(id: string): Promise<SupplyPositionDto[]> {
        const orderIds = await this.listOrderIds(id);

        if (orderIds.length === 0) {
            return [];
        }

        const maxOrdersPerRequest = 100;
        let remainingOrderIds = orderIds.slice();
        const allPositions: SupplyPositionDto[] = [];

        do {
            const batch = remainingOrderIds.slice(0, maxOrdersPerRequest);
            remainingOrderIds = remainingOrderIds.slice(maxOrdersPerRequest);

            const labelsResponse = await this.wbOrderService.getOrdersStickers(batch);

            if (!labelsResponse.success) {
                throw new HttpException(labelsResponse.error, 400);
            }

            allPositions.push(
                ...batch.map((orderId) => ({
                    supplyId: id,
                    barCode: find(labelsResponse.stickers, sticker => sticker.orderId === orderId)?.barcode || "",
                    remark: orderId.toString(),
                    quantity: 1,
                }))
            );
        } while (remainingOrderIds.length > 0);

        return allPositions;
    }

    async list(next = 0): Promise<WbSupplyDto[]> {
        const res = await this.api.method(
            '/api/v3/supplies',
            'get',
            { limit: 1000, next },
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

    async listOrderIds(id: string): Promise<number[]> {
        const data = await this.api.method(
            `/api/marketplace/v3/supplies/${id}/order-ids`,
            'get',
            {},
        );
        return data.orderIds ?? [];
    }
}
