import { Injectable, Optional } from '@nestjs/common';
import { MpService } from '../../mp-event/mp-event.service';
import { ISalePriceSource } from '../../interfaces/IOrderable';
import { PostingService } from '../../posting/posting.service';
import { WbOrderService } from '../../wb.order/wb.order.service';
import { YandexOrderService } from '../../yandex.order/yandex.order.service';

/** Площадка → кто знает нашу цену по заказу. Новая площадка — одна строка здесь плюс метод у неё. */
@Injectable()
export class SalePriceSources {
    private readonly map = new Map<MpService, ISalePriceSource>();

    constructor(
        @Optional() ozon?: PostingService,
        @Optional() wb?: WbOrderService,
        @Optional() yandex?: YandexOrderService,
    ) {
        if (ozon) this.map.set('OZON', ozon);
        if (wb) this.map.set('WB', wb);
        if (yandex) this.map.set('YANDEX', yandex);
    }

    of(service: MpService): ISalePriceSource | undefined {
        return this.map.get(service);
    }
}
