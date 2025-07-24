import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from 'src/interfaces/i.command.acync';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';
import { ExtraPriceService } from '../extra.price.service';

@Injectable()
export class UpdatePriceForGoodSkusCommand implements ICommandAsync<IGoodsProcessingContext> {
  constructor(
    @Inject(forwardRef(() => ExtraPriceService))
    private readonly extraPriceService: ExtraPriceService
  ) {}

  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    await this.extraPriceService.updatePriceForGoodSkus(context.skus);
    return context;
  }
} 