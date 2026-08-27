import { FirebirdTransaction } from 'ts-firebird';
import { GoodAvitoDto } from '../good/dto/good.avito.dto';

/**
 * Справочник привязок «объявление Авито ↔ товар».
 * Отдельный интерфейс: авито-часть не нужна всем реализациям IGood и не должна их к себе принуждать.
 */
export interface IAvitoGoodStore {
    /** Только действующие привязки: помеченные как удалённые на Авито не отдаются. */
    getAllAvitoGoods(): Promise<GoodAvitoDto[]>;
    getAvitoData(ids: string[]): Promise<GoodAvitoDto[]>;
    setAvitoData(data: GoodAvitoDto, t?: FirebirdTransaction): Promise<void>;
    /** Мягкое отключение привязки: строка остаётся в справочнике, из выгрузки уходит. */
    disableAvitoGoods(ids: string[], reason: string, t?: FirebirdTransaction): Promise<void>;
}

export const AVITO_GOOD_STORE = 'AVITO_GOOD_STORE';
