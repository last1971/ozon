import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FixedPercentMarkup } from './fixed.percent.markup';
import { PriceCalculationHelper } from '../../helpers/price/price.calculation.helper';
import { SyliusPriceService } from '../../sylius.price/sylius.price.service';

/** Uniservice: 20/10/5 % и минимальная прибыль 20 ₽; собственные настройки UNISVS_*. */
@Injectable()
export class UnisvsMarkup extends FixedPercentMarkup {
    constructor(
        priceCalculationHelper: PriceCalculationHelper,
        syliusPriceService: SyliusPriceService,
        configService: ConfigService,
    ) {
        super(priceCalculationHelper, syliusPriceService, configService, 'UNISVS', 'Uniservice', {
            old_perc: 20,
            perc: 10,
            min_perc: 5,
            minProfitRub: 20,
        });
    }
}
