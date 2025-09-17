import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { ProductService } from '../../product/product.service';

@Injectable()
export class GetAllOzonSkusCommand implements ICommandAsync<IGoodsProcessingContext> {
    constructor(private readonly productService: ProductService) {}

    async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
        // Загружаем SKU список если он еще не загружен
        if (this.productService.skuList.length === 0) {
            await this.productService.loadSkuList();
        }

        context.ozonSkus = this.productService.skuList;
        context.logger?.log(`Получено ${context.ozonSkus.length} Ozon SKU для массового обновления`);

        return context;
    }
}