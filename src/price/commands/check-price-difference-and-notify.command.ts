import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { ExtraPriceService } from '../extra.price.service';

@Injectable()
export class CheckPriceDifferenceAndNotifyCommand implements ICommandAsync<IGoodsProcessingContext> {
  constructor(
    @Inject(forwardRef(() => ExtraPriceService))
    private readonly extraPriceService: ExtraPriceService
  ) {}

  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    await this.extraPriceService.checkPriceDifferenceAndNotify(context.ozonSkus);
    return context;
  }
} 