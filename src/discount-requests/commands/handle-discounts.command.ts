import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IDiscountProcessingContext } from '../../interfaces/i.discount.processing.context';
import { ExtraPriceService } from '../../price/extra.price.service';

@Injectable()
export class HandleDiscountsCommand implements ICommandAsync<IDiscountProcessingContext> {
  constructor(
    @Inject(forwardRef(() => ExtraPriceService))
    private readonly extraPriceService: ExtraPriceService,
  ) {}

  async execute(context: IDiscountProcessingContext): Promise<IDiscountProcessingContext> {
    if (context.originalOfferIds && context.originalOfferIds.length > 0) {
      await this.extraPriceService.handleDiscounts(context.originalOfferIds);
    }
    return context;
  }
} 