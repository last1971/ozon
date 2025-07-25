import { Injectable } from '@nestjs/common';
import { ICommandAsync } from '../../interfaces/i.command.acync';
import { IGoodsProcessingContext } from '../../interfaces/i.good.processing.context';
import { ExtraGoodService } from '../../good/extra.good.service';
import { GoodServiceEnum } from '../../good/good.service.enum';

@Injectable()
export class TradeSkusCommand implements ICommandAsync<IGoodsProcessingContext> {
  constructor(private readonly extraGoodService: ExtraGoodService) {}

  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    context.ozonSkus = await this.extraGoodService.tradeSkusToServiceSkus(context.skus, GoodServiceEnum.OZON);
    return context;
  }
} 