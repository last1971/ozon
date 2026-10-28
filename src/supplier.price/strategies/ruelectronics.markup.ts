import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FixedPercentMarkup } from './fixed.percent.markup';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../../sylius.price/sylius.price.service';

/**
 * Наценка ruelectronics — «как у Компэла» (владелец 28.10.2026): 15/8/4 % от VIP-цены и страховка 10 ₽, свои
 * настройки RUELECTRONICS_OLD_PERC / RUELECTRONICS_MARKUP_PERC / RUELECTRONICS_MIN_PERC / RUELECTRONICS_MIN_PROFIT_RUB.
 */
@Injectable()
export class RuelectronicsMarkup extends FixedPercentMarkup {
    constructor(
        priceCalculationHelper: PriceCalculationHelper,
        syliusPriceService: SyliusPriceService,
        configService: ConfigService,
    ) {
        super(priceCalculationHelper, syliusPriceService, configService, 'RUELECTRONICS', 'ruelectronics');
    }
}
