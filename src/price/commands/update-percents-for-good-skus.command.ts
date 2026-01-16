import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ICommandAsync } from 'src/interfaces/i.command.acync';
import { IGoodsProcessingContext } from 'src/interfaces/i.good.processing.context';
import { ExtraPriceService } from '../extra.price.service';

@Injectable()
export class UpdatePercentsForGoodSkusCommand implements ICommandAsync<IGoodsProcessingContext> {
  constructor(
    @Inject(forwardRef(() => ExtraPriceService))
    private readonly extraPriceService: ExtraPriceService
  ) {}

  async execute(context: IGoodsProcessingContext): Promise<IGoodsProcessingContext> {
    context.logger?.log(`Начинаем обновление процентов для ${context.ozonSkus?.length || 0} Ozon + ${(context.skus?.length || 0) - (context.ozonSkus?.length || 0)} generic товаров`);
    await this.extraPriceService.updatePercentsForGoodSkus(context.ozonSkus, context.skus);
    context.logger?.log(`Завершено обновление процентов`);
    return context;
  }
} 