import { GoodServiceEnum } from '../good/good.service.enum';
import { IJobContext } from './i.job.context';
import { ITnvedUpdateable, TnvedMarketOffer } from './i.tnved.updateable';

/** Отчёт «на маркетплейсе есть, у нас ТН ВЭД пуст». */
export interface MissingTnvedReport {
    market: GoodServiceEnum;
    offers: number; // карточек на маркетплейсе всего
    /** Товар в базе есть, ТН ВЭД не заполнен — заполнять у нас */
    noTnved: TnvedMarketOffer[];
    /** Такого кода товара у нас нет вообще (артикул не числовой или чужой) — привязка карточки, не ТН ВЭД */
    notInBase: TnvedMarketOffer[];
}

/**
 * Контекст «где у нас пусто» через паттерн команда: каталог маркетплейса → множества базы → разность.
 * Не зависит от сверки: базой тут служит весь справочник товаров, а не только с ТН ВЭД.
 */
export interface IMissingTnvedContext extends IJobContext {
    market: GoodServiceEnum;
    service: ITnvedUpdateable;

    offers?: TnvedMarketOffer[];
    /** Все коды товаров базы (GOODS) */
    allGoods?: Set<string>;
    /** Коды с заполненным ТН ВЭД (GOODS_CLASSIF) */
    withTnved?: Set<string>;

    report?: MissingTnvedReport;
}
