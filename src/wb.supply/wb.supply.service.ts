import { Injectable } from '@nestjs/common';
import { WbApiService } from '../wb.api/wb.api.service';
import { WbSupplyDto } from './dto/wb.supply.dto';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from '../supply/dto/supply.dto';
import { GoodServiceEnum } from '../good/good.service.enum';

@Injectable()
export class WbSupplyService implements ISuppliable {
    private next: number = 0;
    private supplies: WbSupplyDto[] = [];
    constructor(private api: WbApiService) {}

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
}
