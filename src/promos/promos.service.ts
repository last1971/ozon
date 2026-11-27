import { Injectable } from '@nestjs/common';
import { OzonPromosApi } from './promos.api';
import { Action } from './promos.types';

/**
 * Акции Ozon — только чтение. С 12.10.2026 цена в акции и есть цена товара: товар участвует сам,
 * пока его предельная цена не выше порога акции. Цену задаёт OzonPriceWriter по единому правилу.
 */
@Injectable()
export class PromosService {
    constructor(private readonly api: OzonPromosApi) {}

    getActions(): Promise<Action[]> {
        return this.api.listActions();
    }
}
