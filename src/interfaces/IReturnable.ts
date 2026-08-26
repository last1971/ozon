import { ReturnDto } from '../posting/dto/return.dto';

/**
 * Маркетплейс, умеющий отдавать возвраты после выкупа. Конвейер `processReturns`
 * работает с любым, кто реализует интерфейс (Озон, ВБ); Яндекс и FBO-сервисы
 * его не реализуют и в возвраты не попадают — раньше это решалось проверкой
 * имени класса, что ломалось на первом же втором маркетплейсе.
 */
export interface IReturnable {
    /** Возвраты за рабочее окно, нормализованные в озоновский словарь состояний. */
    listReturns(): Promise<ReturnDto[]>;
    /**
     * Числитель/знаменатель признака частичности возврата.
     * `undefined` — судить нечем, и мы не судим.
     */
    returnCounts(item: ReturnDto): Promise<{ returnedRows: number; postingUnits: number } | undefined>;
}

export function isReturnable(service: unknown): service is IReturnable {
    const s = service as IReturnable;
    return typeof s?.listReturns === 'function' && typeof s?.returnCounts === 'function';
}

/**
 * Умеет спросить возвраты по конкретным отправлениям — ТОЧЕЧНОЙ ручкой маркетплейса,
 * за всю историю (окно прогона тут не годится). Отдельно от `IReturnable`: конвейеру
 * возвратов этот метод не нужен, и требовать его от всех — значит ломать тех, кому он
 * не сдался. Нужен суточной сверке отменённых счетов.
 *
 * Реализуют только те, у кого такая ручка ЕСТЬ. У ВБ её нет: там заявки приходят пачкой
 * и матчатся на заказы уже у нас, окном в 120 дней и по `srid`. Изобразить контракт
 * фильтром поверх общего списка — значит пообещать «за всю историю» и тихо пропускать
 * то, что в окно не попало, да ещё и выкачивать все заявки ради нескольких номеров.
 * Поэтому ВБ сверкой не покрыт, и это лучше, чем покрыт на словах.
 */
export interface IReturnsByPostings {
    listReturnsByPostings(postingNumbers: string[]): Promise<ReturnDto[]>;
}

export function hasReturnsByPostings(service: unknown): service is IReturnsByPostings {
    return typeof (service as IReturnsByPostings)?.listReturnsByPostings === 'function';
}
