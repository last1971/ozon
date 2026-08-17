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
