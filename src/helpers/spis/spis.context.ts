import { FirebirdTransaction } from 'ts-firebird';

/** Что уходит в документ списания: SPISANIE_UNIV1 с минусом — приход (пересортица). */
export interface SpisDoc {
    goodscode: string;
    username: string;
    quan: number;
    prim: string;
    osnSpisId: number;
}

/**
 * Контекст любой цепочки, которая делает документ списания: приём возвратов, пересортица.
 * `spis` готовит шаг цепочки, знающий свой документ; номер выдаёт AllocateSpisCodeCommand.
 */
export interface ISpisContext {
    t: FirebirdTransaction;
    spis?: SpisDoc;
    spisCode?: number;
}
