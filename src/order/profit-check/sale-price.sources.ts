import { Injectable, Optional } from '@nestjs/common';
import { MpService } from '../../mp-event/mp-event.service';
import { IOrderable, ISalePriceSource } from '../../interfaces/IOrderable';
import { PostingService } from '../../posting/posting.service';
import { WbOrderService } from '../../wb.order/wb.order.service';
import { YandexOrderService } from '../../yandex.order/yandex.order.service';

/** Площадка → кто знает нашу цену по заказу. Новая площадка — одна строка здесь плюс метод у неё. */
@Injectable()
export class SalePriceSources {
    private readonly map = new Map<MpService, IOrderable>();

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

    /**
     * Площадка по покупателю счёта — у самих площадок, тем же getBuyerId, по которому они счёт и создают:
     * разойтись не могут. Своя копия ключей env без их дефолтов на рознице (OZON_BUYER_ID не задан → 24416)
     * теряла FBS и FBO Озона (17–18.10.2026).
     */
    serviceOfBuyer(buyerId: number): MpService | null {
        for (const [service, source] of this.map) {
            if (Number(source.getBuyerId()) === Number(buyerId)) return service;
        }
        return null;
    }
}
