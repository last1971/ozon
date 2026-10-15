/**
 * Отказ приёма или списания по правилам (не сбой). Бросается командой — цепочка рвётся,
 * транзакция откатывается целиком, кладовщик видит текст как есть.
 */
export class ReturnRefusedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReturnRefusedError';
    }
}
