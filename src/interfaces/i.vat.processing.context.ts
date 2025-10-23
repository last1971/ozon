import { IVatUpdateable } from './i.vat.updateable';

/**
 * Контекст для обработки операций с НДС через паттерн команда
 * Работает только с числами
 */
export interface IVatProcessingContext {
    /** Сервис для обновления НДС (Ozon, WB, Yandex) */
    service: IVatUpdateable;

    /** Ожидаемая ставка НДС для проверки и установки (число в процентах: 0, 5, 7, 10, 20, 22) */
    expectedVat?: number;

    /** Список несоответствий НДС после проверки */
    mismatches?: Array<{ offer_id: string; current_vat: number; expected_vat: number }>;

    /** Результат обновления НДС */
    updateResult?: any;

    /** Лимит записей за один запрос при проверке */
    limit?: number;

    /** Флаг для остановки цепочки команд */
    stopChain?: boolean;

    /** Логгер для вывода информации */
    logger?: { log: (msg: string) => void; error: (msg: string) => void };
}
