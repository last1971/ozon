import { Controller, Get, Param, NotFoundException } from "@nestjs/common";
import { ApiTags, ApiParam } from '@nestjs/swagger';
import { WbSupplyService } from '../wb.supply/wb.supply.service';
import { ISuppliable } from '../interfaces/i.suppliable';
import { SupplyDto } from './dto/supply.dto';
import { Trade2006InvoiceService } from '../trade2006.invoice/trade2006.invoice.service';
import { SupplyPositionDto } from "./dto/supply.position.dto";
import { GoodServiceEnum } from '../good/good.service.enum';
import { IProductable } from "../interfaces/i.productable";
import { ProductService } from "../product/product.service";
import { WbCardService } from '../wb.card/wb.card.service';
import { StockType } from "../product/stock.type";

@ApiTags('supply')
@Controller('supply')
export class SupplyController {
    private supplyServices: ISuppliable[];
    private productServices: Map<GoodServiceEnum, IProductable>;
    constructor(
        private wbSupplyService: WbSupplyService,
        private invoiceService: Trade2006InvoiceService,
        private productService: ProductService,
        private wbCardService: WbCardService,
    ) {
        this.supplyServices = [wbSupplyService, invoiceService];
        this.productServices = new Map<GoodServiceEnum, IProductable>([
            [GoodServiceEnum.WB, wbCardService],
            [GoodServiceEnum.OZON, productService]
        ]);
    }

    @Get('list')
    async list(): Promise<SupplyDto[]> {
        const ret = await Promise.all(this.supplyServices.map((service) => service.getSupplies()));
        return ret.flat();
    }

    @Get('orders/:id/:type/:supplier')
    @ApiParam({ name: 'supplier', enum: GoodServiceEnum, description: 'Supplier type' })
    @ApiParam({ name: 'type', enum: StockType, description: 'Type of supply' })
    @ApiParam({ name: 'id', type: String, description: 'Supply id' })
    async getOrders(@Param('id') id: string, @Param('type') type: StockType, @Param('supplier') supplier: GoodServiceEnum): Promise<SupplyPositionDto[]> {
        const service = this.productServices.get(supplier);
        if (!service) {
            throw new NotFoundException(`Service for supplier ${supplier} not found`);
        }
        if (type === StockType.FBO) {
            return this.invoiceService.getSupplyPositions(id, service);
        } 
        return this.wbSupplyService.getSupplyPositions(id);
    }
}
