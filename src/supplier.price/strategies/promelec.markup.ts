import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FixedPercentMarkup } from './fixed.percent.markup';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../../sylius.price/sylius.price.service';

/** Собственные настройки Promelec: 4/8/15 %, минимальная прибыль 10 ₽. */
@Injectable()
export class PromelecMarkup extends FixedPercentMarkup {
    constructor(helper: PriceCalculationHelper, sylius: SyliusPriceService, config: ConfigService) {
        super(helper, sylius, config, 'PROMELEC', 'promelec');
    }
}
