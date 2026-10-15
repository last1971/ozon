import { FirebirdTransaction } from 'ts-firebird';
import { ReturnLineDto } from '../dto/return-line.dto';
import { ReturnCardDto } from '../dto/return-card.dto';
import { ReturnAction } from '../dto/return-request.dto';

/** Контекст цепочки приёма строки возврата. Всё — в одной транзакции `t`. */
export interface AcceptContext {
    t: FirebirdTransaction;
    line: ReturnLineDto;
    action: ReturnAction;
    username: string;
    /** Сырые сканы марок с экрана. */
    scans: string[];
    comment: string | null;
    osnSpisId: number | null;
    /** LoadReturnCard: свежий снимок внутри транзакции. */
    card?: ReturnCardDto;
    /** ValidateMarks: КИ, разобранные единой читалкой. */
    kis: string[];
    /** UnretireMarks: коды, чей вывод продажей уже ушёл в ГИС МТ, — очередь «вернуть в оборот». */
    retiredKis: string[];
    /** RecordAccept: ID строки журнала приёма. */
    acceptId?: number;
    /** RunWriteOff: итог цепочки списания. */
    writeOff?: WriteOffContext;
}

/** Контекст цепочки списания принятой строки возврата. */
export interface WriteOffContext {
    t: FirebirdTransaction;
    service: ReturnLineDto['service'];
    extId: string;
    posting: string;
    goodscode: string;
    quan: number;
    kis: string[];
    username: string;
    osnSpisId: number;
    comment: string | null;
    /** AllocateSpisCode: номер строки списания, выданный заранее. */
    spisCode?: number;
}
