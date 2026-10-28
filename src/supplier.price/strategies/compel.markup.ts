import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FixedPercentMarkup } from './fixed.percent.markup';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../../sylius.price/sylius.price.service';

/** Наценка Компэла (владелец 27.10.2026): 15/8/4 % и страховка 10 ₽, настройки COMPEL_OLD_PERC / COMPEL_MARKUP_PERC / COMPEL_MIN_PERC / COMPEL_MIN_PROFIT_RUB. */
@Injectable()
export class CompelMarkup extends FixedPercentMarkup {
    constructor(
        priceCalculationHelper: PriceCalculationHelper,
        syliusPriceService: SyliusPriceService,
        configService: ConfigService,
    ) {
        super(priceCalculationHelper, syliusPriceService, configService, 'COMPEL', 'Компэла');
    }
}
