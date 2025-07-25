import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';
import { PriceService } from '../../price/price.service';
import { ProductVisibility } from '../../product/product.visibility';

@Injectable()
export class GetPricesMapCommand implements ICommandAsync<IDiscountProcessingContext> {
    constructor(
        @Inject(forwardRef(() => PriceService))
        private readonly priceService: PriceService,
    ) {}

    async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
        const tasks = context.tasks || [];
        const offerIds = tasks.map((task) => task.offer_id);
        if (offerIds.length === 0) {
            return { ...context, pricesMap: new Map() };
        }
        const pricesResponse = await this.priceService.index({
            offer_id: offerIds,
            limit: 1000,
            visibility: ProductVisibility.ALL,
        });
        const pricesMap = new Map();
        (pricesResponse.data || []).forEach((item) => {
            pricesMap.set(item.offer_id, item);
        });
        return { ...context, pricesMap };
    }
}
