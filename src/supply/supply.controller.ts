import { Controller, Get, Param } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { WbSupplyService } from '../wb.supply/wb.supply.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from './dto/supply.dto';

@ApiTags('supply')
@Controller('supply')
export class SupplyController {
    private supplyServices: Map<GoodServiceEnum, ISuppliable>;
    constructor(private wbSupplyService: WbSupplyService) {
        this.supplyServices = new Map<GoodServiceEnum, ISuppliable>();
        this.supplyServices.set(GoodServiceEnum.WB, wbSupplyService);
    }

    @Get('list')
    // @ApiParam({ name: 'supplier', enum: GoodServiceEnum, description: 'Supplier type' })
    async list(): Promise<SupplyDto[]> {
        const ret = await Promise.all(Array.from(this.supplyServices.values()).map((service) => service.getSupplies()));
        return ret.flat();
    }
}
