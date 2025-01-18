import { Injectable } from '@nestjs/common';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbSupplyDto } from './dto/wb.supply.dto';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from '../supply/dto/supply.dto';
import { GoodServiceEnum } from '../good/good.service.enum';
import { SupplyPositionDto } from 'src/supply/dto/supply.position.dto';
import { WbSupplyOrdersDto } from "./dto/wb.supply.orders.dto";

@Injectable()
export class WbSupplyService implements ISuppliable {
    private next: number = 0;
    private supplies: WbSupplyDto[] = [];

    constructor(private api: WbApiService) {
    }

    getSupplyPositions(id: string): Promise<SupplyPositionDto[]> {
        throw new Error('Method not implemented.');
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
