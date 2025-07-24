import { Inject, Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { GOOD_SERVICE, IGood } from '../../interfaces/IGood';

@Injectable()
export class ResetAvailablePriceCommand implements ICommandAsync<IGoodsProcessingContext> {
  constructor(@Inject(GOOD_SERVICE) private readonly goodService: IGood) {}

  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    await this.goodService.resetAvailablePrice(context.skus);
    return context;
  }
}
