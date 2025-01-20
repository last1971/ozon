import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from '@nestjs/swagger';
import { WbSupplyService } from '../wb.supply/wb.supply.service';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from './dto/supply.dto';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { SupplyPositionDto } from "./dto/supply.position.dto";

@ApiTags('supply')
@Controller('supply')
export class SupplyController {
    private supplyServices: ISuppliable[];
    constructor(
        private wbSupplyService: WbSupplyService,
        private invoiceService: Trade2006InvoiceService,
    ) {
        this.supplyServices = [wbSupplyService, invoiceService];
    }

    @Get('list')
    // @ApiParam({ name: 'supplier', enum: GoodServiceEnum, description: 'Supplier type' })
    async list(): Promise<SupplyDto[]> {
        const ret = await Promise.all(this.supplyServices.map((service) => service.getSupplies()));
        return ret.flat();
    }

    @Get('orders/:id')
    async getOrders(@Param('id') id: string): Promise<SupplyPositionDto[]> {
        return this.wbSupplyService.getSupplyPositions(id);
    }
}
