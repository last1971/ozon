import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WbSupplyService } from '../wb.supply/wb.supply.service';
import { GoodServiceEnum } from '../good/good.service.enum';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from './dto/supply.dto';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';

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
}
