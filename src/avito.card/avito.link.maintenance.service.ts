import { Inject, Injectable, Logger } from '@nestjs/common';
import { AvitoApiService } from '../avito.api/avito.api.service';
import { AvitoItemStatus, isPermanentlyGone } from '../avito.api/avito.item.status';
import { AVITO_GOOD_STORE, IAvitoGoodStore } from '../interfaces/i.avito.good.store';
import { GoodAvitoDto } from '../good/dto/good.avito.dto';

/**
 * Обслуживание справочника привязок: единственное место, где привязка выводится из оборота.
 * Отделено от выгрузки остатков намеренно — чтение остатков не должно менять справочник.
 */
@Injectable()
export class AvitoLinkMaintenanceService {
    private readonly logger = new Logger(AvitoLinkMaintenanceService.name);

    constructor(
        private readonly api: AvitoApiService,
        @Inject(AVITO_GOOD_STORE) private readonly store: IAvitoGoodStore,
    ) {}

    /**
     * Отключает привязки объявлений, удалённых на Авито.
     * Строго по статусу removed: 400 от API сам по себе поводом не является.
     * Возвращает id, которые были отключены.
     */
    async disableDeadLinks(candidates: GoodAvitoDto[]): Promise<string[]> {
        const dead: GoodAvitoDto[] = [];
        for (const avito of candidates) {
            const probe = await this.api.getItemStatus(avito.id);
            if (isPermanentlyGone(probe)) {
                dead.push(avito);
                continue;
            }
            if (probe.kind === 'status') {
                this.logger.warn(`Авито ${avito.id}: статус ${probe.status} — привязка сохранена`);
            } else if (probe.kind === 'unknown-status') {
                this.logger.warn(`Авито ${avito.id}: неизвестный статус «${probe.raw}» — привязка сохранена`);
            } else {
                this.logger.warn(`Авито ${avito.id}: статус не получен (${probe.message}) — привязка сохранена`);
            }
        }

        if (dead.length === 0) return [];

        dead.forEach((avito) =>
            this.logger.log(
                `Авито ${avito.id}: объявление удалено — привязка отключена ` +
                    `(goodscode ${avito.goodsCode}, coeff ${avito.coeff}, commission ${avito.commission})`,
            ),
        );
        const ids = dead.map((avito) => avito.id);
        await this.store.disableAvitoGoods(ids, AvitoItemStatus.Removed);
        return ids;
    }
}
