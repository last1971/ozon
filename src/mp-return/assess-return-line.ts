import { ReturnInvoiceLine, ReturnLineCode } from '../interfaces/i.return.stock';
import { ReturnLineDto } from './dto/return-line.dto';
import { ReturnAcceptViewDto, ReturnInvoiceViewDto, ReturnRowStatus } from './dto/return-card.dto';
import { ALL_CANCELLATION_SUFFIXES } from '../helpers/order.cancellation.constants';

export interface AssessInput {
    line: ReturnLineDto;
    invoice: ReturnInvoiceViewDto | null;
    invoiceLine: ReturnInvoiceLine | null;
    codes: ReturnLineCode[];
    quan: number;
    marksRequired: boolean;
    accepted: ReturnAcceptViewDto | null;
}

export interface Assessment {
    warnings: string[];
    blockers: string[];
    canAccept: boolean;
    canWriteOff: boolean;
}

const DEFECT_REASON = /брак|поврежд|не работает|дефект|сломан/i;

/**
 * Единственное место, где решается, можно ли принять строку возврата и о чём предупредить.
 * Карточка показывает результат, команда AssertAcceptable отказывает по нему же — расхождения
 * «на экране можно, а сервер не дал» быть не может.
 */
export function assessReturnLine(c: AssessInput): Assessment {
    const warnings: string[] = [];
    const blockers: string[] = [];
    const { line, invoice, invoiceLine, codes, quan } = c;

    if (!line.receivedAt) warnings.push('Ozon ещё не отметил посылку полученной');
    if (line.reason && DEFECT_REASON.test(line.reason))
        warnings.push('Брак по словам покупателя — проверить до приёма');
    if (line.isOpened) warnings.push('Покупатель вскрывал упаковку');

    if (!invoice) {
        blockers.push('Счёт по отправлению не найден — возможно, посылка другого кабинета');
        return finish(c, warnings, blockers);
    }
    const manualMark = invoice.mark.trim() && !ALL_CANCELLATION_SUFFIXES.some((s) => invoice.mark.endsWith(s));
    if (manualMark) warnings.push(`В примечании счёта пометка «${invoice.mark.trim()}» — поставлена руками`);
    if (invoice.status === 5) blockers.push('Счёт закрыт — возврат невозможен, оприходуйте товар');
    if (invoice.status === 6) blockers.push('Счёт в корзине — возврат невозможен, оприходуйте товар');

    if (!invoiceLine) {
        blockers.push(`В счёте нет строки с товаром ${line.offerId}`);
        return finish(c, warnings, blockers);
    }
    if (invoiceLine.picked < quan) {
        blockers.push(`На строке подобрано ${invoiceLine.picked}, вернулось ${quan}`);
    } else if (invoiceLine.picked - quan < invoiceLine.shipped) {
        blockers.push('По строке выписан УПД — возврат невозможен, оприходуйте товар');
    }

    if (codes.some((k) => k.transferType === 2)) blockers.push('Коды строки переданы по FBO — разобрать руками');
    const foreignRetired = codes.find((k) => k.status === 6 && k.retireReason !== 1);
    if (foreignRetired) {
        blockers.push(`Код выведен не продажей (причина ${foreignRetired.retireReason ?? '—'}) — разобрать руками`);
    }
    if (c.marksRequired) {
        const covered = codes.filter((k) => k.transferType !== 2).reduce((sum, k) => sum + k.quantity, 0);
        if (covered < quan) blockers.push(`На строке кодов на ${covered} шт, вернулось ${quan}`);
    }
    if (codes.some((k) => k.status === 6 && k.retireReason === 1 && k.chzSent)) {
        warnings.push('Марки выведены продажей в Честном знаке — вернуть в оборот отдельно');
    }
    return finish(c, warnings, blockers);
}

function finish(c: AssessInput, warnings: string[], blockers: string[]): Assessment {
    return {
        warnings,
        blockers,
        canAccept: !c.accepted && blockers.length === 0,
        canWriteOff: c.accepted?.decision === 'RETURN' && !c.accepted.spisCode,
    };
}

/** Итоговый статус строки списка. */
export function returnRowStatus(accepted: ReturnAcceptViewDto | null, blockers: string[]): ReturnRowStatus {
    if (accepted?.decision === 'PROBLEM') return 'problem';
    if (accepted?.spisCode) return 'written-off';
    if (accepted) return 'accepted';
    return blockers.length ? 'blocked' : 'pending';
}
